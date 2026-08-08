import "server-only";

import type { ConsumptionProof } from "@/core/chain/server/proof/proof";
import { serializeProof, signProofAs } from "@/core/chain/server/proof/proof";
import { findUserWallet } from "@/core/chain/server/wallet/repository";
import type { PurchaseOrderView } from "@/core/purchase/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { purchaseRepository } from "../repository/purchase-repository";
import { toPurchaseView } from "./purchase-view";

type ConfirmDeps = {
    findOrder: typeof purchaseRepository.findOrder;
    findCafeOwner: typeof purchaseRepository.findCafeOwner;
    findUserWallet: typeof findUserWallet;
    requireOwner: typeof requireCafeRole;
    signProof: typeof signProofAs;
    updateOrderAndQueue: typeof purchaseRepository.updateOrderAndQueue;
};

const defaultDeps: ConfirmDeps = {
    findOrder: purchaseRepository.findOrder,
    findCafeOwner: purchaseRepository.findCafeOwner,
    findUserWallet,
    requireOwner: requireCafeRole,
    signProof: signProofAs,
    updateOrderAndQueue: purchaseRepository.updateOrderAndQueue,
};

export async function confirmPurchaseService(
    confirmingUserId: string,
    orderId: string,
    deps: Partial<ConfirmDeps> = {},
): AsyncAppResult<PurchaseOrderView> {
    const d = { ...defaultDeps, ...deps };
    try {
        const order = await d.findOrder(orderId);
        if (!order) return err(AppErrors.notFound({ targets: ["orderId"] }));

        const ownerAuth = await d.requireOwner(confirmingUserId, order.cafeId, [
            "owner",
        ]);
        if (!ownerAuth.ok) return ownerAuth;

        if (order.status !== "user_confirmed") {
            if (order.status === "expired") {
                return err(AppErrors.conflict({ targets: ["status"] }));
            }
            return ok(toPurchaseView(order));
        }
        if (order.expiry.getTime() <= Date.now()) {
            return err(AppErrors.conflict({ targets: ["expiry"] }));
        }
        if (
            typeof order.chainCafeId !== "number" ||
            typeof order.chainProductId !== "number"
        ) {
            return err(
                AppErrors.unprocessableEntity({ targets: ["chainMapping"] }),
            );
        }

        const owner = await d.findCafeOwner(order.cafeId);
        if (!owner || owner.userId !== confirmingUserId) {
            return err(AppErrors.forbidden());
        }
        const buyerWallet = await d.findUserWallet(order.userId);
        const ownerWallet = await d.findUserWallet(owner.userId);
        if (
            !buyerWallet?.walletAddress ||
            buyerWallet.walletIndex === null ||
            ownerWallet?.walletIndex === null ||
            ownerWallet?.walletIndex === undefined
        ) {
            return err(AppErrors.unprocessableEntity({ targets: ["wallet"] }));
        }

        const proof: ConsumptionProof = {
            cafeId: BigInt(order.chainCafeId),
            user: buyerWallet.walletAddress as `0x${string}`,
            productId: BigInt(order.chainProductId),
            amount: order.amount,
            receiptHash: order.receiptHash as `0x${string}`,
            nonce: BigInt(order.nonce),
            expiry: BigInt(Math.floor(order.expiry.getTime() / 1000)),
        };
        const [userSignature, cafeSignature] = await Promise.all([
            d.signProof(buyerWallet.walletIndex, proof),
            d.signProof(ownerWallet.walletIndex, proof),
        ]);

        const queueResult = await d.updateOrderAndQueue(order.id, {
            proof: serializeProof(proof),
            cafeSignature,
            userSignature,
        });
        const queued =
            "outcome" in queueResult ? queueResult.order : queueResult;
        if ("outcome" in queueResult && queueResult.outcome === "current") {
            if (
                queued.status === "expired" ||
                queued.expiry.getTime() <= Date.now()
            ) {
                return err(AppErrors.conflict({ targets: ["expiry"] }));
            }
            return ok(toPurchaseView(queued));
        }
        return ok(toPurchaseView(queued));
    } catch {
        return err(
            AppErrors.unexpected(new Error("purchase confirmation failed")),
        );
    }
}
