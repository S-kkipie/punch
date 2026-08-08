import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import type { DbClient } from "@/server/drizzle/db";
import { consumerTransaction } from "@/server/drizzle/schemas/consumption-schema";
import {
    type CampaignRow,
    type ConsumerVoucherRow,
    campaign,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";

export async function findActiveCampaignForCafe(
    client: DbClient,
    cafeId: string,
): Promise<CampaignRow | null> {
    const now = new Date();
    const [row] = await client
        .select()
        .from(campaign)
        .where(
            and(
                eq(campaign.cafeId, cafeId),
                eq(campaign.active, true),
                lte(campaign.windowStart, now),
                gte(campaign.windowEnd, now),
            ),
        );
    return row ?? null;
}

export async function hasPriorPaidPurchase(
    client: DbClient,
    consumerUserId: string,
    cafeId: string,
    excludingTransactionId: string,
): Promise<boolean> {
    const rows = await client
        .select({ id: consumerTransaction.id })
        .from(consumerTransaction)
        .where(
            and(
                eq(consumerTransaction.consumerUserId, consumerUserId),
                eq(consumerTransaction.cafeId, cafeId),
                eq(consumerTransaction.operation, "emission"),
                eq(consumerTransaction.status, "confirmed"),
            ),
        );
    return rows.some((row) => row.id !== excludingTransactionId);
}

export async function unlockCampaignVoucher(
    client: DbClient,
    input: {
        campaignId: string;
        consumerUserId: string;
        cafeId: string;
        expiresAt: Date;
    },
): Promise<ConsumerVoucherRow | null> {
    const [row] = await client
        .insert(consumerVoucher)
        .values({
            source: "campaign",
            campaignId: input.campaignId,
            consumerUserId: input.consumerUserId,
            cafeId: input.cafeId,
            expiresAt: input.expiresAt,
        })
        .onConflictDoNothing({
            target: [
                consumerVoucher.campaignId,
                consumerVoucher.consumerUserId,
            ],
        })
        .returning();
    return row ?? null;
}
