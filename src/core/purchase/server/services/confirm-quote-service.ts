import "server-only";

import { isAuthorizedCafeOperator } from "@/core/chain/server/cafe-authorization";
import {
    buildReceiptHash,
    type ConsumptionProof,
    randomNonce,
    signProofAs,
} from "@/core/chain/server/proof/proof";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { findUserWallet } from "@/core/chain/server/wallet/repository";
import type { QuoteBridgeResult } from "@/core/purchase/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import {
    bridgeQuoteToOrder,
    findQuoteForBridge,
    getExistingBridge,
} from "../repository/quote-bridge-repository";

type ConfirmQuoteDeps = {
    now: () => Date;
    generateOrderId: () => string;
    randomNonce: typeof randomNonce;
    signProof: typeof signProofAs;
    findQuote: typeof findQuoteForBridge;
    findExistingBridge: typeof getExistingBridge;
    ensureCurrentCafeAuthorization: (
        quote: NonNullable<Awaited<ReturnType<typeof findQuoteForBridge>>>,
    ) => Promise<boolean>;
    ensureWallet: typeof assignWallet;
    findUserWallet: typeof findUserWallet;
    bridgeQuoteToOrder: typeof bridgeQuoteToOrder;
};

const defaultDeps: ConfirmQuoteDeps = {
    now: () => new Date(),
    generateOrderId: () => crypto.randomUUID(),
    randomNonce,
    signProof: signProofAs,
    findQuote: findQuoteForBridge,
    findExistingBridge: getExistingBridge,
    ensureCurrentCafeAuthorization: async (quote) => {
        const operatorWallet = await findUserWallet(quote.issuedByUserId);
        if (
            !operatorWallet?.walletAddress ||
            operatorWallet.walletIndex === null
        ) {
            return false;
        }
        if (typeof quote.chainCafeId !== "number") return false;
        return isAuthorizedCafeOperator({
            chainCafeId: quote.chainCafeId,
            walletAddress: operatorWallet.walletAddress as `0x${string}`,
        });
    },
    ensureWallet: assignWallet,
    findUserWallet,
    bridgeQuoteToOrder,
};

export async function confirmQuoteService(
    consumerUserId: string,
    quoteId: string,
    deps: Partial<ConfirmQuoteDeps> = {},
): AsyncAppResult<QuoteBridgeResult> {
    const d = { ...defaultDeps, ...deps };
    try {
        const quote = await d.findQuote(quoteId);
        if (!quote) return err(AppErrors.notFound({ targets: ["quoteId"] }));
        if (quote.consumerUserId && quote.consumerUserId !== consumerUserId) {
            return err(AppErrors.forbidden());
        }
        if (quote.purchaseOrderId) {
            return ok(await d.findExistingBridge(quote));
        }
        const now = d.now();
        if (
            quote.status !== "issued" ||
            quote.expiresAt.getTime() <= now.getTime()
        ) {
            return err(AppErrors.conflict({ targets: ["status"] }));
        }
        if (
            typeof quote.chainCafeId !== "number" ||
            typeof quote.chainProductId !== "number"
        ) {
            return err(
                AppErrors.unprocessableEntity({ targets: ["chainMapping"] }),
            );
        }
        const authorized = await d.ensureCurrentCafeAuthorization(quote);
        if (!authorized) {
            return err(
                AppErrors.unprocessableEntity({ targets: ["operator"] }),
            );
        }

        const consumerWallet = await d.ensureWallet(consumerUserId);
        const operatorWallet = await d.findUserWallet(quote.issuedByUserId);
        if (
            operatorWallet?.walletIndex === null ||
            operatorWallet?.walletIndex === undefined ||
            !operatorWallet.walletAddress
        ) {
            return err(AppErrors.unprocessableEntity({ targets: ["wallet"] }));
        }

        const orderId = d.generateOrderId();
        const proof: ConsumptionProof = {
            cafeId: BigInt(quote.chainCafeId),
            user: consumerWallet.address as `0x${string}`,
            productId: BigInt(quote.chainProductId),
            amount: BigInt(quote.amountCentimos) * 10_000n,
            receiptHash: buildReceiptHash(orderId, quote.yapeRef),
            nonce: d.randomNonce(),
            expiry: BigInt(
                Math.floor(
                    Math.min(
                        quote.expiresAt.getTime(),
                        now.getTime() + 10 * 60 * 1000,
                    ) / 1000,
                ),
            ),
        };
        const userSignature = await d.signProof(
            consumerWallet.walletIndex,
            proof,
        );
        const cafeSignature = await d.signProof(
            operatorWallet.walletIndex,
            proof,
        );

        return ok(
            await d.bridgeQuoteToOrder({
                quoteId: quote.id,
                consumerUserId,
                now,
                orderId,
                proof,
                cafeSignature,
                userSignature,
            }),
        );
    } catch {
        return err(
            AppErrors.unexpected(new Error("quote confirmation failed")),
        );
    }
}
