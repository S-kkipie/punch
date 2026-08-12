import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";

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

const campaignChainOpKinds = [
    "campaign_create",
    "campaign_fund_approve",
    "campaign_fund",
    "campaign_publish",
] as const;

/** Escrituras on-chain que una campaña disparó, de la más nueva a la más vieja. */
export type CampaignChainOp = {
    campaignId: string;
    kind: string;
    status: "pending" | "submitted" | "confirmed" | "failed";
    txHash: string | null;
    error: string | null;
    createdAt: Date;
};

/**
 * Los jobs de campaña no tienen columna propia de campaña: la llevan en el
 * payload, así que el filtro sale de ahí.
 */
export async function listCampaignChainOps(
    campaignIds: string[],
): Promise<CampaignChainOp[]> {
    if (campaignIds.length === 0) return [];
    const rows = await db
        .select({
            campaignId: sql<string>`${relayerJob.payload}->>'campaignId'`,
            kind: relayerJob.kind,
            status: relayerJob.status,
            txHash: relayerJob.txHash,
            error: relayerJob.lastError,
            createdAt: relayerJob.createdAt,
        })
        .from(relayerJob)
        .where(
            and(
                inArray(relayerJob.kind, campaignChainOpKinds),
                inArray(sql`${relayerJob.payload}->>'campaignId'`, campaignIds),
            ),
        )
        .orderBy(desc(relayerJob.createdAt));
    return rows as CampaignChainOp[];
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
