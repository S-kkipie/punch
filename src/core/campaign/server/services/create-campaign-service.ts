import "server-only";

import { findCafeById } from "@/core/cafe/server/repository/find-cafe-by-id";
import { createCampaignSchema } from "@/core/campaign/domain/schemas";
import type { CampaignParams } from "@/core/campaign/domain/types";
import { enqueueJob } from "@/core/chain/server/relayer/job-repository";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { insertCampaign } from "../repository/campaign-repository";

export async function createCampaignService(
    userId: string,
    cafeId: string,
    input: CampaignParams,
): AsyncAppResult<{ campaignId: string }> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;

        const parsed = createCampaignSchema.safeParse(input);
        if (!parsed.success) {
            return err(AppErrors.invalidBody({ cause: parsed.error }));
        }

        const cafe = await findCafeById(cafeId);
        if (!cafe || cafe.chainCafeId === null) {
            return err(AppErrors.notFound({ targets: ["cafeId"] }));
        }

        const campaignId = crypto.randomUUID();
        await db.transaction(async (tx) => {
            await insertCampaign(tx, {
                id: campaignId,
                kind: "verified_acquisition",
                cafeId,
                name: parsed.data.name,
                windowStart: parsed.data.windowStart,
                windowEnd: parsed.data.windowEnd,
                active: true,
                voucherPayout: parsed.data.voucherPayout,
                maxVouchers: parsed.data.maxVouchers,
            });
            await enqueueJob(tx, {
                kind: "campaign_create",
                idempotencyKey: `campaign_create:${campaignId}`,
                payload: {
                    campaignId,
                    chainCafeId: cafe.chainCafeId,
                },
            });
        });

        return ok({ campaignId });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
