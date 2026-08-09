import "server-only";

import type { ConfirmPurchase } from "@/core/consumption/domain/types";
import type { QuoteBridgeResult } from "@/core/purchase/domain/types";
import { confirmQuoteService } from "@/core/purchase/server/services/confirm-quote-service";
import type { AsyncAppResult } from "@/server/common/responses";

export async function confirmPurchaseService(
    consumerUserId: string,
    input: ConfirmPurchase,
): AsyncAppResult<QuoteBridgeResult> {
    return confirmQuoteService(consumerUserId, input.proofId);
}
