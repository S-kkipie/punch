import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import {
    chainPurchaseEffect,
    coffeeCrawl,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import { applyChainPurchaseEffects } from "../chain-purchase-effects";

const describeIntegration = describe.skipIf(
    process.env.PUNCH_RUN_INTEGRATION !== "1",
);
installIntegrationDbMutex();
const suffix = crypto.randomUUID();
const userId = `crawl-referral-user-${suffix}`;
const cafeIds = [0, 1, 2].map((i) => `crawl-referral-cafe-${suffix}-${i}`);
const productIds = [0, 1, 2].map(
    (i) => `crawl-referral-product-${suffix}-${i}`,
);
const orderIds = [0, 1, 2].map((i) => `crawl-referral-order-${suffix}-${i}`);
const crawlId = `crawl-referral-crawl-${suffix}`;
const chainCafeIds = [11, 12, 13];
const walletAddress = `0x${suffix.replaceAll("-", "").padEnd(40, "0")}`;

async function seed() {
    await db.insert(user).values({
        id: userId,
        name: "Crawl Referral User",
        email: `${suffix}@crawl-referral.invalid`,
        walletAddress,
    });
    for (let i = 0; i < cafeIds.length; i++) {
        await db.insert(cafe).values({
            id: cafeIds[i],
            name: `Crawl Referral Cafe ${i}`,
            slug: `crawl-referral-${suffix}-${i}`,
            chainCafeId: chainCafeIds[i],
            onboardingStatus: "approved",
        });
        await db.insert(cafeProduct).values({
            id: productIds[i],
            cafeId: cafeIds[i],
            name: `Crawl Referral Product ${i}`,
            priceSoles: "8",
            type: "emission",
            approvalStatus: "approved",
            active: true,
        });
    }
    await db.insert(coffeeCrawl).values({
        id: crawlId,
        name: "Crawl Referral Crawl",
        expiresAt: new Date(Date.now() + 60_000),
        active: true,
    });
    await db.insert(coffeeCrawlStep).values(
        cafeIds.map((cafeId, stepIndex) => ({
            id: `crawl-referral-step-${suffix}-${stepIndex}`,
            crawlId,
            stepIndex,
            cafeId,
        })),
    );
    for (let i = 0; i < orderIds.length; i++) {
        await db.insert(purchaseOrder).values({
            id: orderIds[i],
            cafeId: cafeIds[i],
            userId,
            productId: productIds[i],
            amount: 8_000_000n,
            yapeRef: `crawl-referral-${orderIds[i]}`,
            receiptHash: `0x${String(i + 1).padStart(64, "0")}`,
            nonce: `${i}`,
            expiry: new Date(Date.now() + 60_000),
            status: "submitted",
        });
    }
}

async function apply(index: number) {
    await db.transaction(async (tx) => {
        await applyChainPurchaseEffects(tx, {
            purchaseOrderId: orderIds[index],
            consumerUserId: userId,
            cafeId: cafeIds[index],
            productId: productIds[index],
            transactionHash: `0x${String(index + 1).padStart(64, "0")}`,
            logIndex: index,
            blockNumber: BigInt(index + 1),
            confirmedAt: new Date(),
        });
    });
}

async function cleanup() {
    await db
        .delete(relayerJob)
        .where(eq(relayerJob.idempotencyKey, `referral:crawl:${userId}:11:12`));
    await db
        .delete(relayerJob)
        .where(eq(relayerJob.idempotencyKey, `referral:crawl:${userId}:12:13`));
    await db
        .delete(consumerCrawlProgress)
        .where(eq(consumerCrawlProgress.consumerUserId, userId));
    await db
        .delete(consumerVoucher)
        .where(eq(consumerVoucher.consumerUserId, userId));
    await db
        .delete(chainPurchaseEffect)
        .where(inArray(chainPurchaseEffect.purchaseOrderId, orderIds));
    await db.delete(purchaseOrder).where(eq(purchaseOrder.userId, userId));
    await db
        .delete(coffeeCrawlStep)
        .where(eq(coffeeCrawlStep.crawlId, crawlId));
    await db.delete(coffeeCrawl).where(eq(coffeeCrawl.id, crawlId));
    await db.delete(cafeProduct).where(inArray(cafeProduct.id, productIds));
    await db.delete(cafe).where(inArray(cafe.id, cafeIds));
    await db.delete(user).where(eq(user.id, userId));
}

describeIntegration("crawl referral enqueueing", () => {
    afterEach(cleanup);

    it("enqueues A-to-B and B-to-C referrals, not the first purchase or a replay", async () => {
        await seed();
        await apply(0);
        await apply(1);
        await apply(1);
        await apply(2);

        const jobs = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.kind, "referral_record"));
        const referralJobs = jobs.filter((job) =>
            job.idempotencyKey.startsWith(`referral:crawl:${userId}:`),
        );
        expect(referralJobs).toHaveLength(2);
        expect(referralJobs.map((job) => job.idempotencyKey).sort()).toEqual([
            `referral:crawl:${userId}:11:12`,
            `referral:crawl:${userId}:12:13`,
        ]);
        expect(
            referralJobs.find((job) => job.idempotencyKey.endsWith("11:12"))
                ?.payload,
        ).toMatchObject({
            originCafeId: 11,
        });
        expect(
            referralJobs.find((job) => job.idempotencyKey.endsWith("12:13"))
                ?.payload,
        ).toMatchObject({
            originCafeId: 12,
        });
    });
});
