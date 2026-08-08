import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { progressFraction } from "@/core/punch/domain/progress";
import type { Dashboard } from "@/core/punch/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import {
    campaign,
    coffeeCrawl,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import { getBalance } from "../repository/balance";

export async function getDashboardService(
    userId: string,
): AsyncAppResult<Dashboard> {
    try {
        const balance = await getBalance(userId);
        let activeCampaign: Dashboard["activeCampaign"] = null;
        let activeCrawl: Dashboard["activeCrawl"] = null;
        try {
            const now = new Date();
            const vouchers = await db
                .select()
                .from(consumerVoucher)
                .where(
                    and(
                        eq(consumerVoucher.consumerUserId, userId),
                        eq(consumerVoucher.status, "available"),
                        gt(consumerVoucher.expiresAt, now),
                    ),
                );
            const campaignVoucher = vouchers.find(
                (voucher) =>
                    voucher.source === "campaign" &&
                    voucher.campaignId &&
                    voucher.cafeId,
            );
            if (campaignVoucher?.campaignId && campaignVoucher.cafeId) {
                const [row] = await db
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
                    activeCampaign = {
                        id: row.id,
                        name: row.name,
                        cafeId: row.cafeId,
                    };
            }
            const [progress] = await db
                .select()
                .from(consumerCrawlProgress)
                .where(
                    and(
                        eq(consumerCrawlProgress.consumerUserId, userId),
                        eq(consumerCrawlProgress.status, "in_progress"),
                    ),
                );
            if (progress) {
                const [crawl] = await db
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
                    const steps = await db
                        .select({ id: coffeeCrawlStep.id })
                        .from(coffeeCrawlStep)
                        .where(eq(coffeeCrawlStep.crawlId, crawl.id));
                    activeCrawl = {
                        id: crawl.id,
                        name: crawl.name,
                        completedSteps: progress.completedCafeIds.length,
                        totalSteps: steps.length,
                    };
                }
            }
        } catch {
            // Dashboard balance remains available if optional campaign data is unavailable.
        }

        return ok({
            balance,
            progress: progressFraction(balance),
            activeCampaign,
            activeCrawl,
        });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
