import "server-only";

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

/**
 * Cancela un borrador y devuelve su presupuesto al dueño del café. Una campaña
 * publicada no se puede cancelar nunca — esa es justamente la garantía de que
 * el voucher que ve el cliente vale — así que aquí se rechaza antes de llegar
 * a la cadena.
 */
export async function cancelCampaignService(
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
        if (row.campaign.chainCampaignId === null) {
            return err(AppErrors.conflict({ targets: ["campaignId"] }));
        }
        if (row.projection?.status !== "draft") {
            return err(AppErrors.conflict({ targets: ["campaignId"] }));
        }

        await db.transaction(async (tx) => {
            await enqueueJob(tx, {
                kind: "campaign_cancel",
                idempotencyKey: `campaign_cancel:${campaignId}`,
                payload: {
                    campaignId,
                    chainCampaignId: row.campaign.chainCampaignId,
                },
            });
        });

        return ok({ queued: true });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
