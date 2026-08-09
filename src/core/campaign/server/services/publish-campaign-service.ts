import "server-only";

import { canPublish, requiredBudget } from "@/core/campaign/domain/transitions";
import { findCampaignWithProjection } from "@/core/campaign/server/repository/campaign-repository";
import { enqueueJob } from "@/core/chain/server/relayer/job-repository";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";

export async function publishCampaignService(
    userId: string,
    cafeId: string,
    campaignId: string,
): AsyncAppResult<{ queued: true }> {
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
        const voucherPayout = row.campaign.voucherPayout;
        const maxVouchers = row.campaign.maxVouchers;
        const required = requiredBudget({ voucherPayout, maxVouchers });
        if (row.projection?.status === "published") {
            return err(AppErrors.conflict({ targets: ["campaignId"] }));
        }
        if (!canPublish(row.projection, required)) {
            return err(
                AppErrors.unprocessableEntity({ targets: ["campaignId"] }),
            );
        }
        if (row.campaign.chainCampaignId === null) {
            return err(AppErrors.conflict({ targets: ["campaignId"] }));
        }

        await db.transaction(async (tx) => {
            await enqueueJob(tx, {
                kind: "campaign_publish",
                idempotencyKey: `campaign_publish:${campaignId}`,
                payload: {
                    campaignId,
                    chainCampaignId: row.campaign.chainCampaignId,
                    voucherPayout: voucherPayout.toString(),
                    maxVouchers,
                    windowEnd: row.campaign.windowEnd.toISOString(),
                },
            });
        });

        return ok({ queued: true });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
