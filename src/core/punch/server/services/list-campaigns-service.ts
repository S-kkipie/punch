import "server-only";
import { eq } from "drizzle-orm";
import type { Campaign } from "@/core/punch/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { campaign } from "@/server/drizzle/schemas/punch-schema";

const toCampaign = (row: typeof campaign.$inferSelect): Campaign => ({
    id: row.id,
    kind: row.kind,
    cafeId: row.cafeId,
    name: row.name,
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    active: row.active,
});

export async function listCampaignsService(): AsyncAppResult<Campaign[]> {
    try {
        const rows = await db
            .select()
            .from(campaign)
            .where(eq(campaign.active, true));
        return ok(rows.map(toCampaign));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}

export async function getCampaignService(id: string): AsyncAppResult<Campaign> {
    try {
        const [row] = await db
            .select()
            .from(campaign)
            .where(eq(campaign.id, id));
        return row
            ? ok(toCampaign(row))
            : err(AppErrors.notFound({ targets: ["id"] }));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
