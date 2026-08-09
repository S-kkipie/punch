import "server-only";

import { findCampaignWithProjection } from "@/core/campaign/server/repository/campaign-repository";
import { enqueueJob } from "@/core/chain/server/relayer/job-repository";
import { findUserWallet } from "@/core/purchase/server/repository/purchase-repository";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";

export async function fundCampaignService(
    userId: string,
    cafeId: string,
    campaignId: string,
    amount: bigint,
): AsyncAppResult<{ fundingId: string }> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;
        if (amount <= 0n) return err(AppErrors.invalidBody());

        const row = await findCampaignWithProjection(campaignId);
        if (!row || row.campaign.cafeId !== cafeId) {
            return err(AppErrors.notFound({ targets: ["campaignId"] }));
        }
        if (
            row.campaign.chainCampaignId === null ||
            row.projection?.status !== "draft"
        ) {
            return err(AppErrors.conflict({ targets: ["campaignId"] }));
        }

        const wallet = await findUserWallet(userId);
        if (wallet?.walletIndex === null || wallet?.walletIndex === undefined) {
            return err(AppErrors.conflict({ targets: ["walletIndex"] }));
        }

        const fundingId = crypto.randomUUID();
        await db.transaction(async (tx) => {
            await enqueueJob(tx, {
                kind: "campaign_fund_approve",
                idempotencyKey: `campaign_fund_approve:${campaignId}:${fundingId}`,
                payload: {
                    campaignId,
                    chainCampaignId: row.campaign.chainCampaignId,
                    amount: amount.toString(),
                    walletIndex: wallet.walletIndex,
                    fundingId,
                },
            });
        });

        return ok({ fundingId });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
