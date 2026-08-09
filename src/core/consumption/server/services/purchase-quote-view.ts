import { maskYapeRef } from "@/core/consumption/domain/quotes";
import type { PurchaseQuoteView } from "@/core/consumption/domain/types";
import type { ConsumptionProofRow } from "@/server/drizzle/schemas/consumption-schema";

export function toPurchaseQuoteView(
    row: Pick<
        ConsumptionProofRow,
        | "id"
        | "cafeId"
        | "productId"
        | "amountCentimos"
        | "expiresAt"
        | "status"
        | "yapeRef"
        | "purchaseOrderId"
        | "failureReason"
        | "createdAt"
    >,
): PurchaseQuoteView {
    return {
        id: row.id,
        cafeId: row.cafeId,
        productId: row.productId,
        amountCentimos: row.amountCentimos,
        expiresAt: row.expiresAt.toISOString(),
        status: row.status,
        maskedYapeRef: maskYapeRef(row.yapeRef),
        purchaseOrderId: row.purchaseOrderId,
        failureReason: row.failureReason,
        createdAt: row.createdAt.toISOString(),
    };
}
