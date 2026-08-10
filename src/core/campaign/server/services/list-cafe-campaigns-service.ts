import "server-only";

import { calculateCampaignFunding } from "@/core/campaign/domain/funding";
import type { CampaignLifecycle } from "@/core/campaign/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { listCafeCampaigns } from "../repository/campaign-repository";

export type CafeCampaign = {
    id: string;
    cafeId: string;
    name: string;
    windowStart: Date;
    windowEnd: Date;
    voucherPayout: bigint;
    maxVouchers: number;
    lifecycle: CampaignLifecycle;
    required: bigint;
    funded: bigint;
    missing: bigint;
    canPublish: boolean;
};

export async function listCafeCampaignsService(
    userId: string,
    cafeId: string,
): AsyncAppResult<CafeCampaign[]> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;

        const rows = await listCafeCampaigns(cafeId);
        const campaigns: CafeCampaign[] = [];
        for (const row of rows) {
            if (
                row.campaign.voucherPayout === null ||
                row.campaign.maxVouchers === null
            ) {
                return err(AppErrors.conflict({ targets: ["campaignId"] }));
            }
            const funding = calculateCampaignFunding(
                {
                    voucherPayout: row.campaign.voucherPayout,
                    maxVouchers: row.campaign.maxVouchers,
                    chainCampaignId: row.campaign.chainCampaignId,
                },
                row.projection,
            );
            campaigns.push({
                id: row.campaign.id,
                cafeId: row.campaign.cafeId,
                name: row.campaign.name,
                windowStart: row.campaign.windowStart,
                windowEnd: row.campaign.windowEnd,
                voucherPayout: row.campaign.voucherPayout,
                maxVouchers: row.campaign.maxVouchers,
                ...funding,
            });
        }
        return ok(campaigns);
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
