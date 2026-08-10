import "server-only";

import { calculateCampaignFunding } from "@/core/campaign/domain/funding";
import type { CampaignLifecycle } from "@/core/campaign/domain/types";
import { findCampaignWithProjection } from "@/core/campaign/server/repository/campaign-repository";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";

export async function getCampaignFundingService(
    userId: string,
    cafeId: string,
    campaignId: string,
): AsyncAppResult<{
    required: bigint;
    funded: bigint;
    missing: bigint;
    lifecycle: CampaignLifecycle;
    canPublish: boolean;
}> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;

        const row = await findCampaignWithProjection(campaignId);
        if (!row || row.campaign.cafeId !== cafeId) {
            return err(AppErrors.notFound({ targets: ["campaignId"] }));
        }

        if (
            row.campaign.voucherPayout === null ||
            row.campaign.maxVouchers === null
        ) {
            return err(AppErrors.conflict({ targets: ["campaignId"] }));
        }
        return ok(
            calculateCampaignFunding(
                {
                    voucherPayout: row.campaign.voucherPayout,
                    maxVouchers: row.campaign.maxVouchers,
                    chainCampaignId: row.campaign.chainCampaignId,
                },
                row.projection,
            ),
        );
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
