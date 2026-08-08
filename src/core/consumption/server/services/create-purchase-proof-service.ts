import "server-only";

import { findCafeById } from "@/core/cafe/server/repository/find-cafe-by-id";
import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { chain } from "@/core/chain/chain";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import {
    PURCHASE_PROOF_TTL_SECONDS,
    PURCHASE_PROOF_TYPES,
    type PurchaseProofMessage,
    purchaseProofDomain,
} from "@/core/consumption/domain/eip712";
import { generateNonce } from "@/core/consumption/domain/nonce";
import type { CreatePurchaseProof } from "@/core/consumption/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import {
    DEMO_CONSUMPTION_VERIFIER_ADDRESS,
    UNBOUND_CONSUMER_ADDRESS,
} from "../demo-chain-context";
import { createProof } from "../repository/proofs";

export type PurchaseProofIssued = {
    id: string;
    expiresAt: string;
    deepLink: string;
};

function solesToCentimos(priceSoles: string): number {
    const amount = Number(priceSoles);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.round(amount * 100);
}

export async function createPurchaseProofService(
    baristaUserId: string,
    cafeId: string,
    input: CreatePurchaseProof,
): AsyncAppResult<PurchaseProofIssued> {
    const membershipResult = await requireCafeRole(baristaUserId, cafeId, [
        "owner",
        "barista",
    ]);
    if (!membershipResult.ok) return err(membershipResult.error);

    const cafeRow = await findCafeById(cafeId);
    if (cafeRow?.onboardingStatus !== "approved") {
        return err(AppErrors.notFound({ targets: ["cafeId"] }));
    }

    const product = await findProductById(input.productId);
    if (!product || product.cafeId !== cafeId) {
        return err(AppErrors.notFound({ targets: ["productId"] }));
    }
    const amountCentimos = solesToCentimos(product.priceSoles);
    if (
        product.type !== "emission" ||
        product.approvalStatus !== "approved" ||
        !product.active ||
        amountCentimos <= 0
    ) {
        return err(
            AppErrors.unprocessableEntity({
                targets: ["productId"],
                cause: "Este producto no puede emitir PUNCH.",
            }),
        );
    }

    const wallet = await assignWallet(baristaUserId);
    const account = deriveUserAccount(wallet.walletIndex);
    const nonce = generateNonce();
    const now = Math.floor(Date.now() / 1000);
    const expiry = BigInt(now + PURCHASE_PROOF_TTL_SECONDS);
    const chainId = chain.id;
    const verifyingContract = DEMO_CONSUMPTION_VERIFIER_ADDRESS;
    const payload: PurchaseProofMessage = {
        cafeId,
        user: UNBOUND_CONSUMER_ADDRESS,
        productId: input.productId,
        amountCentimos: BigInt(amountCentimos),
        receiptHash: input.receiptHash as `0x${string}`,
        nonce,
        expiry,
        chainId: BigInt(chainId),
        verifyingContract,
    };

    const cafeSignature = await account.signTypedData({
        domain: purchaseProofDomain({ verifyingContract, chainId }),
        types: PURCHASE_PROOF_TYPES,
        primaryType: "PurchaseProof",
        message: payload,
    });
    const row = await createProof({
        cafeId,
        productId: input.productId,
        issuedByUserId: baristaUserId,
        amountCentimos,
        receiptHash: input.receiptHash,
        nonce,
        cafeSignature,
        status: "issued",
        expiresAt: new Date(Number(expiry) * 1000),
    });

    return ok({
        id: row.id,
        expiresAt: row.expiresAt.toISOString(),
        deepLink: `/purchase/${row.id}`,
    });
}
