import "server-only";
import { and, asc, eq, gt } from "drizzle-orm";
import { type DbClient, db } from "@/server/drizzle/db";
import {
    campaign,
    coffeeCrawl,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";

export async function getDashboardReadData(
    userId: string,
    client: DbClient = db,
) {
    const now = new Date();
    const vouchers = await client
        .select()
        .from(consumerVoucher)
        .where(
            and(
                eq(consumerVoucher.consumerUserId, userId),
                eq(consumerVoucher.status, "available"),
                gt(consumerVoucher.expiresAt, now),
            ),
        );
    let activeCampaign: { id: string; name: string; cafeId: string } | null =
        null;
    const campaignVoucher = vouchers.find(
        (voucher) => voucher.source === "campaign" && voucher.campaignId,
    );
    if (campaignVoucher?.campaignId) {
        const [row] = await client
            .select()
            .from(campaign)
            .where(
                and(
                    eq(campaign.id, campaignVoucher.campaignId),
                    eq(campaign.active, true),
                    gt(campaign.windowEnd, now),
                ),
            );
        if (row)
            activeCampaign = { id: row.id, name: row.name, cafeId: row.cafeId };
    }
    let activeCrawl: {
        id: string;
        name: string;
        completedSteps: number;
        totalSteps: number;
    } | null = null;
    const [progress] = await client
        .select()
        .from(consumerCrawlProgress)
        .where(
            and(
                eq(consumerCrawlProgress.consumerUserId, userId),
                eq(consumerCrawlProgress.status, "in_progress"),
            ),
        );
    if (progress) {
        const [crawl] = await client
            .select()
            .from(coffeeCrawl)
            .where(
                and(
                    eq(coffeeCrawl.id, progress.crawlId),
                    eq(coffeeCrawl.active, true),
                    gt(coffeeCrawl.expiresAt, now),
                ),
            );
        if (crawl) {
            const steps = await client
                .select({ id: coffeeCrawlStep.id })
                .from(coffeeCrawlStep)
                .where(eq(coffeeCrawlStep.crawlId, crawl.id))
                .orderBy(asc(coffeeCrawlStep.stepIndex));
            activeCrawl = {
                id: crawl.id,
                name: crawl.name,
                completedSteps: progress.completedCafeIds.length,
                totalSteps: steps.length,
            };
        }
    }
    return { activeCampaign, activeCrawl };
}

export async function listConsumerVouchersForUser(
    userId: string,
    client: DbClient = db,
) {
    return client
        .select()
        .from(consumerVoucher)
        .where(eq(consumerVoucher.consumerUserId, userId));
}
