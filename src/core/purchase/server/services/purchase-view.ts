import type { PurchaseOrderView } from "@/core/purchase/domain/types";
import type { PurchaseOrderRow } from "@/server/drizzle/schemas/purchase-schema";

export function toPurchaseView(
    row: Pick<
        PurchaseOrderRow,
        | "id"
        | "cafeId"
        | "productId"
        | "amount"
        | "status"
        | "failureReason"
        | "txHash"
        | "expiry"
        | "createdAt"
    >,
): PurchaseOrderView {
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
