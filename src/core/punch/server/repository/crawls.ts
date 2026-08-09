import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import type { DbClient } from "@/server/drizzle/db";
import {
    type CoffeeCrawlRow,
    type CoffeeCrawlStepRow,
    type ConsumerCrawlProgressRow,
    type ConsumerVoucherRow,
    coffeeCrawl,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";

export async function findActiveCrawlForCafe(
    client: DbClient,
    cafeId: string,
): Promise<CoffeeCrawlRow | null> {
    const now = new Date();
    const [row] = await client
        .select({ crawl: coffeeCrawl })
        .from(coffeeCrawl)
        .innerJoin(coffeeCrawlStep, eq(coffeeCrawlStep.crawlId, coffeeCrawl.id))
        .where(
            and(
                eq(coffeeCrawlStep.cafeId, cafeId),
                eq(coffeeCrawl.active, true),
                gte(coffeeCrawl.expiresAt, now),
            ),
        );
    return row?.crawl ?? null;
}

export async function getCrawlSteps(
    client: DbClient,
    crawlId: string,
): Promise<CoffeeCrawlStepRow[]> {
    return client
        .select()
        .from(coffeeCrawlStep)
        .where(eq(coffeeCrawlStep.crawlId, crawlId))
        .orderBy(asc(coffeeCrawlStep.stepIndex));
}

export async function getOrCreateCrawlProgress(
    client: DbClient,
    crawlId: string,
    consumerUserId: string,
): Promise<ConsumerCrawlProgressRow> {
    const [existing] = await client
        .select()
        .from(consumerCrawlProgress)
        .where(
            and(
                eq(consumerCrawlProgress.crawlId, crawlId),
                eq(consumerCrawlProgress.consumerUserId, consumerUserId),
            ),
        );
    if (existing) return existing;
    const [created] = await client
        .insert(consumerCrawlProgress)
        .values({ crawlId, consumerUserId })
        .onConflictDoNothing()
        .returning();
    if (created) return created;
    const [winner] = await client
        .select()
        .from(consumerCrawlProgress)
        .where(
            and(
                eq(consumerCrawlProgress.crawlId, crawlId),
                eq(consumerCrawlProgress.consumerUserId, consumerUserId),
            ),
        );
    if (!winner)
        throw new Error("getOrCreateCrawlProgress: lost race with no row");
    return winner;
}

export async function advanceCrawlProgress(
    client: DbClient,
    progressId: string,
    completedCafeIds: string[],
    completed: boolean,
): Promise<ConsumerCrawlProgressRow> {
    const [row] = await client
        .update(consumerCrawlProgress)
        .set({
            completedCafeIds,
            status: completed ? "completed" : "in_progress",
        })
        .where(eq(consumerCrawlProgress.id, progressId))
        .returning();
    if (!row) throw new Error("advanceCrawlProgress: progress row not found");
    return row;
}

export async function unlockCrawlVoucher(
    client: DbClient,
    input: { crawlId: string; consumerUserId: string; expiresAt: Date },
): Promise<ConsumerVoucherRow | null> {
    const [row] = await client
        .insert(consumerVoucher)
        .values({
            source: "crawl",
            crawlId: input.crawlId,
            consumerUserId: input.consumerUserId,
            expiresAt: input.expiresAt,
        })
        .onConflictDoNothing({
            target: [consumerVoucher.crawlId, consumerVoucher.consumerUserId],
        })
        .returning();
    return row ?? null;
}
