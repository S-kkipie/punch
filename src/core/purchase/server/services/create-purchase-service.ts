import "server-only";

import { buildReceiptHash, randomNonce } from "@/core/chain/server/proof/proof";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { solesToMpen } from "@/core/purchase/domain/schemas";
import type {
    CreatePurchase,
    PurchaseOrderView,
} from "@/core/purchase/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import type { PurchaseOrderRow } from "@/server/drizzle/schemas/purchase-schema";
import { purchaseRepository } from "../repository/purchase-repository";

type CreateDeps = {
    findApprovedCafe: typeof purchaseRepository.findApprovedCafe;
    findEmissionProduct: typeof purchaseRepository.findEmissionProduct;
    ensureWallet: typeof assignWallet;
    insertOrder: typeof purchaseRepository.insertOrder;
};

const defaultDeps: CreateDeps = {
    findApprovedCafe: purchaseRepository.findApprovedCafe,
    findEmissionProduct: purchaseRepository.findEmissionProduct,
    ensureWallet: assignWallet,
    insertOrder: purchaseRepository.insertOrder,
};

function toView(row: PurchaseOrderRow): PurchaseOrderView {
    return {
        id: row.id,
        cafeId: row.cafeId,
        productId: row.productId,
        amountSoles: Number(row.amount) / 1_000_000,
        status: row.status,
        failureReason: row.failureReason,
        txHash: row.txHash,
        expiry: row.expiry.toISOString(),
        createdAt: row.createdAt.toISOString(),
    };
}

export async function createPurchaseService(
    userId: string,
    input: CreatePurchase,
    deps: Partial<CreateDeps> = {},
): AsyncAppResult<PurchaseOrderView> {
    const d = { ...defaultDeps, ...deps };
    try {
        const cafe = await d.findApprovedCafe(input.cafeId);
        if (
            !cafe ||
            cafe.chainCafeId === null ||
            (cafe.onboardingStatus && cafe.onboardingStatus !== "approved")
        ) {
            return err(AppErrors.notFound({ targets: ["cafeId"] }));
        }
        const product = await d.findEmissionProduct(input.productId);
        if (
            !product ||
            product.cafeId !== cafe.id ||
            product.type !== "emission" ||
            product.approvalStatus !== "approved" ||
            product.active !== true ||
            product.chainProductId === null
        ) {
            return err(AppErrors.notFound({ targets: ["productId"] }));
        }

        let amount: bigint;
        try {
            amount = solesToMpen(input.amountSoles);
        } catch {
            return err(AppErrors.invalidBody({ targets: ["amountSoles"] }));
        }
        if (amount < 8_000_000n) {
            return err(
                AppErrors.unprocessableEntity({ targets: ["amountSoles"] }),
            );
        }

        await d.ensureWallet(userId);
        const orderId = crypto.randomUUID();
        const now = new Date();
        const expiry = new Date(now.getTime() + 10 * 60 * 1000);
        const row = await d.insertOrder({
            id: orderId,
            cafeId: cafe.id,
            userId,
            productId: product.id,
            amount,
            yapeRef: input.yapeRef,
            receiptHash: buildReceiptHash(orderId, input.yapeRef),
            nonce: randomNonce().toString(),
            expiry,
            status: "user_confirmed",
        });
        return ok(toView(row));
    } catch {
        return err(AppErrors.unexpected(new Error("purchase creation failed")));
    }
}
