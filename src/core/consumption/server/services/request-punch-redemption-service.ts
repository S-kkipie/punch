import "server-only";
import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { canRedeem } from "@/core/punch/domain/progress";
import { getBalance } from "@/core/punch/server/repository/balance";
import type { RequestPunchRedemption, RedemptionRequest } from "@/core/consumption/domain/types";
import { AppErrors, type AsyncAppResult, err, ok } from "@/server/common/responses";
import { createRedemptionRequest } from "../repository/redemption-requests";
import { toRedemptionRequest } from "../repository/utils";

export async function requestPunchRedemptionService(
    consumerUserId: string,
    cafeId: string,
    input: RequestPunchRedemption,
): AsyncAppResult<RedemptionRequest> {
    const product = await findProductById(input.productId);
    if (!product || product.cafeId !== cafeId) {
        return err(AppErrors.notFound({ targets: ["productId"] }));
    }
    if (product.type !== "reward" || product.approvalStatus !== "approved" || !product.active) {
        return err(AppErrors.unprocessableEntity({ targets: ["productId"] }));
    }
    const balance = await getBalance(consumerUserId);
    if (!canRedeem(balance)) {
        return err(AppErrors.unprocessableEntity({
            targets: ["balance"],
            cause: "Necesitas 12 PUNCH para canjear.",
        }));
    }
    const row = await createRedemptionRequest({
        kind: "punch_reward",
        consumerUserId,
        cafeId,
        productId: input.productId,
        voucherId: null,
        status: "pending",
        rejectionReason: null,
        decidedByUserId: null,
    });
    return ok(toRedemptionRequest(row));
}
