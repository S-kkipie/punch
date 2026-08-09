import "server-only";

import { maskYapeRef } from "@/core/consumption/domain/quotes";
import type { PurchaseQuoteView } from "@/core/consumption/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { expireQuote, findProofById } from "../repository/proofs";

export async function getPurchaseQuoteService(
    _requestingUserId: string,
    quoteId: string,
): AsyncAppResult<PurchaseQuoteView> {
    const row = await findProofById(quoteId);
    if (!row) return err(AppErrors.notFound({ targets: ["proofId"] }));

    let current = row;
    if (
        current.status === "issued" &&
        current.expiresAt.getTime() <= Date.now()
    ) {
        const expired = await expireQuote(quoteId);
        if (expired) current = { ...current, ...expired };
        else current = { ...current, status: "expired" };
    }

    return ok({
        id: current.id,
        cafeId: current.cafeId,
        productId: current.productId,
        amountCentimos: current.amountCentimos,
        expiresAt: current.expiresAt.toISOString(),
        status: current.status,
        maskedYapeRef: maskYapeRef(current.yapeRef),
        purchaseOrderId: current.purchaseOrderId,
        failureReason: current.failureReason,
        createdAt: current.createdAt.toISOString(),
    });
}
