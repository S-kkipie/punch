import "server-only";
import { env } from "@/config/env";
import type {
    DecideRedemptionRequest,
    RedemptionRequest,
} from "@/core/consumption/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { CampaignEscrowChain } from "../campaign-escrow-chain";
import type { ChainSubmission, ConsumerChainPort } from "../chain-port";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import {
    decideRedemptionRequest,
    findRedemptionRequestById,
    RedemptionRequestRepositoryError,
} from "../repository/redemption-requests";
import { toRedemptionRequest } from "../repository/utils";

export async function decideVoucherRedemptionService(
    deciderUserId: string,
    cafeId: string,
    requestId: string,
    input: DecideRedemptionRequest,
): AsyncAppResult<ChainSubmission | RedemptionRequest> {
    const membershipResult = await requireCafeRole(deciderUserId, cafeId, [
        "owner",
        "barista",
    ]);
    if (!membershipResult.ok) return err(membershipResult.error);

    const existing = await findRedemptionRequestById(requestId);
    if (
        !existing ||
        existing.cafeId !== cafeId ||
        existing.kind !== "voucher"
    ) {
        return err(AppErrors.notFound({ targets: ["requestId"] }));
    }
    if (existing.status === "rejected") {
        if (
            input.decision === "rejected" &&
            input.rejectionReason === existing.rejectionReason
        ) {
            return ok(toRedemptionRequest(existing));
        }
        return err(AppErrors.conflict({ targets: ["requestId"] }));
    }
    if (existing.status === "approved" && input.decision === "rejected") {
        return err(AppErrors.conflict({ targets: ["requestId"] }));
    }

    const chain: ConsumerChainPort =
        env.CONSUMER_CHAIN_MODE === "local"
            ? new CampaignEscrowChain()
            : new PostgresMockConsumerChain();
    if (existing.status === "approved") {
        try {
            return ok(
                await chain.submitVoucherRedemption({
                    redemptionRequestId: existing.id,
                    idempotencyKey: `voucher_redemption:${existing.id}`,
                }),
            );
        } catch (cause) {
            return err(AppErrors.unexpected(cause));
        }
    }

    try {
        const request = await decideRedemptionRequest(
            requestId,
            deciderUserId,
            input.decision,
            input.decision === "rejected"
                ? (input.rejectionReason ?? null)
                : null,
        );
        if (request.status === "rejected")
            return ok(toRedemptionRequest(request));
        return ok(
            await chain.submitVoucherRedemption({
                redemptionRequestId: request.id,
                idempotencyKey: `voucher_redemption:${request.id}`,
            }),
        );
    } catch (cause) {
        if (cause instanceof RedemptionRequestRepositoryError) {
            if (cause.code === "REQUEST_NOT_FOUND") {
                return err(AppErrors.notFound({ targets: ["requestId"] }));
            }
            return err(AppErrors.conflict({ targets: ["requestId"] }));
        }
        return err(AppErrors.unexpected(cause));
    }
}
