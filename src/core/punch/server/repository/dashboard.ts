import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { type DbClient, db } from "@/server/drizzle/db";
import {
    consumerCrawlProgress,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import { findActiveCampaignForCafe } from "./campaigns";
import { findActiveCrawlForCafe, getCrawlSteps } from "./crawls";

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
    const progressRows = await client
        .select()
        .from(consumerCrawlProgress)
        .where(
            and(
                eq(consumerCrawlProgress.consumerUserId, userId),
                eq(consumerCrawlProgress.status, "in_progress"),
            ),
        );
    const progressByCrawl = new Map(
        progressRows.map((progress) => [progress.crawlId, progress]),
    );
    const crawlCafeIds = new Set<string>();
    for (const progress of progressRows) {
        const steps = await getCrawlSteps(client, progress.crawlId);
        for (const step of steps) crawlCafeIds.add(step.cafeId);
    }
    const cafeIds = [
        ...new Set([
            ...vouchers.flatMap((voucher) =>
                voucher.cafeId ? [voucher.cafeId] : [],
            ),
            ...crawlCafeIds,
        ]),
    ].sort();

    let activeCampaign: { id: string; name: string; cafeId: string } | null =
        null;
    let activeCrawl: {
        id: string;
        name: string;
        completedSteps: number;
        totalSteps: number;
    } | null = null;
    for (const cafeId of cafeIds) {
        if (!activeCampaign) {
            const campaign = await findActiveCampaignForCafe(client, cafeId);
            if (campaign)
                activeCampaign = {
                    id: campaign.id,
                    name: campaign.name,
                    cafeId: campaign.cafeId,
                };
        }
        if (!activeCrawl) {
            const crawl = await findActiveCrawlForCafe(client, cafeId);
            const progress = crawl ? progressByCrawl.get(crawl.id) : undefined;
            if (crawl && progress) {
                const steps = await getCrawlSteps(client, crawl.id);
                activeCrawl = {
                    id: crawl.id,
                    name: crawl.name,
                    completedSteps: progress.completedCafeIds.length,
                    totalSteps: steps.length,
                };
            }
        }
        if (activeCampaign && activeCrawl) break;
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
