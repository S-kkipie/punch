import "server-only";

import { eq } from "drizzle-orm";
import type { JobTransaction } from "@/core/chain/server/relayer/job-repository";
import type { DbClient, DbTransaction } from "@/server/drizzle/db";
import { db } from "@/server/drizzle/db";
import {
    type ProjectionCampaignRow,
    projectionCampaign,
} from "@/server/drizzle/schemas/chain-schema";
import {
    type CampaignRow,
    campaign,
} from "@/server/drizzle/schemas/punch-schema";

export type CampaignWithProjection = {
    campaign: CampaignRow;
    projection: ProjectionCampaignRow | null;
};

export async function insertCampaign(
    tx: DbTransaction,
    values: typeof campaign.$inferInsert,
): Promise<CampaignRow> {
    const [row] = await tx.insert(campaign).values(values).returning();
    return row;
}

export async function linkChainCampaign(
    tx: JobTransaction,
    campaignId: string,
    chainCampaignId: number,
): Promise<void> {
    await tx
        .update(campaign)
        .set({ chainCampaignId })
        .where(eq(campaign.id, campaignId));
}

export async function findCampaignById(
    campaignId: string,
): Promise<CampaignRow | null> {
    const [row] = await db
        .select()
        .from(campaign)
        .where(eq(campaign.id, campaignId))
        .limit(1);
    return row ?? null;
}

export async function findCampaignWithProjection(
    campaignId: string,
): Promise<CampaignWithProjection | null> {
    const [row] = await campaignWithProjectionQuery(db)
        .where(eq(campaign.id, campaignId))
        .limit(1);
    return row ?? null;
}

export async function listCafeCampaigns(
    cafeId: string,
): Promise<CampaignWithProjection[]> {
    return campaignWithProjectionQuery(db)
        .where(eq(campaign.cafeId, cafeId))
        .orderBy(campaign.createdAt);
}

function campaignWithProjectionQuery(client: DbClient) {
    return client
        .select({ campaign, projection: projectionCampaign })
        .from(campaign)
        .leftJoin(
            projectionCampaign,
            eq(campaign.chainCampaignId, projectionCampaign.chainCampaignId),
        );
}
