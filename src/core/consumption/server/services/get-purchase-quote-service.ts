import "server-only";

import type { PurchaseQuoteView } from "@/core/consumption/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { expireQuote, findProofById } from "../repository/proofs";
import { toPurchaseQuoteView } from "./purchase-quote-view";

export async function getPurchaseQuoteService(
    requestingUserId: string,
    quoteId: string,
): AsyncAppResult<PurchaseQuoteView> {
    const row = await findProofById(quoteId);
    if (!row) return err(AppErrors.notFound({ targets: ["proofId"] }));

    if (row.consumerUserId && row.consumerUserId !== requestingUserId) {
        const membership = await requireCafeRole(requestingUserId, row.cafeId, [
            "owner",
            "barista",
        ]);
        if (!membership.ok) return err(membership.error);
    }

    let current = row;
    if (
        current.status === "issued" &&
        current.expiresAt.getTime() <= Date.now()
    ) {
        const expired = await expireQuote(quoteId);
        if (expired) current = { ...current, ...expired };
        else {
            const refreshed = await findProofById(quoteId);
            if (refreshed) current = refreshed;
            else return err(AppErrors.notFound({ targets: ["proofId"] }));
        }
    }

    return ok(toPurchaseQuoteView(current));
}
