import "server-only";
import type { DecideRedemptionRequest, RedemptionRequest } from "@/core/consumption/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { AppErrors, type AsyncAppResult, err, ok } from "@/server/common/responses";
import type { ChainSubmission } from "../chain-port";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import { decideRedemptionRequest } from "../repository/redemption-requests";
import { toRedemptionRequest } from "../repository/utils";

export async function decidePunchRedemptionService(
    deciderUserId: string,
    cafeId: string,
    requestId: string,
    input: DecideRedemptionRequest,
): AsyncAppResult<ChainSubmission | RedemptionRequest> {
    const membershipResult = await requireCafeRole(deciderUserId, cafeId, ["owner", "barista"]);
    if (!membershipResult.ok) return err(membershipResult.error);
    try {
        const request = await decideRedemptionRequest(
            requestId,
            deciderUserId,
            input.decision,
            input.rejectionReason ?? null,
        );
        if (request.status === "rejected") return ok(toRedemptionRequest(request));
        const submission = await new PostgresMockConsumerChain().submitPunchRedemption({
            redemptionRequestId: request.id,
            idempotencyKey: `punch_redemption:${request.id}`,
        });
        return ok(submission);
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
