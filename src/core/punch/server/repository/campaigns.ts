import "server-only";
import { and, eq, gte, lt, lte, or } from "drizzle-orm";
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
    currentTransaction: { id: string; createdAt: Date },
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
                or(
                    lt(
                        consumerTransaction.createdAt,
                        currentTransaction.createdAt,
                    ),
                    and(
                        eq(
                            consumerTransaction.createdAt,
                            currentTransaction.createdAt,
                        ),
                        lt(consumerTransaction.id, currentTransaction.id),
                    ),
                ),
            ),
        );
    return rows.length > 0;
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
