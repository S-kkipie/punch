import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { applyConfirmedConsumptionProjection } from "@/core/chain/server/indexer/purchase-projection";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import {
    consumerTransaction,
    consumptionProof,
} from "@/server/drizzle/schemas/consumption-schema";
import {
    campaign,
    chainPurchaseEffect,
    coffeeCrawl,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerVoucher,
    punchBalanceProjection,
} from "@/server/drizzle/schemas/punch-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import { clearChainDerivedPurchaseProjections } from "../purchase-projection-rebuild";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

const fixtures: string[] = [];

async function seedMinimalCase(options?: {
    manualCampaignVoucher?: boolean;
    redeemAutoVoucher?: boolean;
    crawl?: boolean;
}) {
    const suffix = crypto.randomUUID();
    const ids = {
        userId: `rebuild-user-${suffix}`,
        cafeId: `rebuild-cafe-${suffix}`,
        productId: `rebuild-product-${suffix}`,
        campaignId: `rebuild-campaign-${suffix}`,
        orderId: `rebuild-order-${suffix}`,
        proofId: `rebuild-proof-${suffix}`,
        crawlId: `rebuild-crawl-${suffix}`,
    };
    const txHash =
        `0x${suffix.replaceAll("-", "").padStart(64, "0")}` as `0x${string}`;
    fixtures.push(ids.userId);
    await db.insert(user).values({
        id: ids.userId,
        name: "Rebuild User",
        email: `${suffix}@rebuild.invalid`,
    });
    await db.insert(cafe).values({
        id: ids.cafeId,
        name: "Rebuild Cafe",
        slug: suffix,
        chainCafeId: 990000 + Math.floor(Math.random() * 9000),
        onboardingStatus: "approved",
    });
    await db.insert(cafeProduct).values({
        id: ids.productId,
        cafeId: ids.cafeId,
        name: "Coffee",
        priceSoles: "8",
        type: "emission",
        approvalStatus: "approved",
        active: true,
        chainProductId: 991002,
    });
    await db.insert(campaign).values({
        id: ids.campaignId,
        kind: "verified_acquisition",
        cafeId: ids.cafeId,
        name: "Campaign",
        windowStart: new Date(Date.now() - 60_000),
        windowEnd: new Date(Date.now() + 60_000),
        active: true,
    });
    await db.insert(purchaseOrder).values({
        id: ids.orderId,
        cafeId: ids.cafeId,
        userId: ids.userId,
        productId: ids.productId,
        amount: 8_000_000n,
        yapeRef: "rebuild-ref",
        receiptHash: `0x${"ab".repeat(32)}`,
        nonce: suffix,
        expiry: new Date(Date.now() + 60_000),
        status: "submitted",
    });
    await db.insert(consumptionProof).values({
        id: ids.proofId,
        cafeId: ids.cafeId,
        productId: ids.productId,
        issuedByUserId: ids.userId,
        consumerUserId: ids.userId,
        amountCentimos: 800,
        purchaseOrderId: ids.orderId,
        yapeRef: "rebuild-ref",
        receiptHash: `0x${"ab".repeat(32)}`,
        nonce: suffix,
        status: "submitted",
        expiresAt: new Date(Date.now() + 60_000),
    });
    if (options?.crawl) {
        await db.insert(coffeeCrawl).values({
            id: ids.crawlId,
            name: "Rebuild Crawl",
            expiresAt: new Date(Date.now() + 60_000),
            active: true,
        });
        await db.insert(coffeeCrawlStep).values({
            id: `rebuild-step-${suffix}`,
            crawlId: ids.crawlId,
            stepIndex: 0,
            cafeId: ids.cafeId,
        });
        await db.insert(consumerCrawlProgress).values({
            id: `rebuild-progress-${suffix}`,
            crawlId: ids.crawlId,
            consumerUserId: ids.userId,
            completedCafeIds: [],
            status: "in_progress",
        });
    }
    if (options?.manualCampaignVoucher) {
        await db.insert(consumerVoucher).values({
            id: `rebuild-manual-voucher-${suffix}`,
            source: "campaign",
            campaignId: ids.campaignId,
            consumerUserId: ids.userId,
            cafeId: ids.cafeId,
            status: "available",
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(Date.now() - 60_000),
        });
    }
    await db.transaction(async (tx) => {
        await applyConfirmedConsumptionProjection(tx, {
            orderId: ids.orderId,
            txHash,
            logIndex: 0,
            blockNumber: 12n,
        });
    });
    if (options?.redeemAutoVoucher) {
        await db
            .update(consumerVoucher)
            .set({ status: "redeemed", redeemedAt: new Date() })
            .where(eq(consumerVoucher.campaignId, ids.campaignId));
    }
    return { ...ids, txHash };
}

describeIntegration("clearChainDerivedPurchaseProjections", () => {
    it("self-heals legacy effect provenance and converges on the next rebuild", async () => {
        const ids = await seedMinimalCase({ crawl: true });
        const replayTxHash =
            `0x${crypto.randomUUID().replaceAll("-", "").padStart(64, "0")}` as `0x${string}`;
        const [legacyVoucher] = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.campaignId, ids.campaignId));
        const [legacyProgress] = await db
            .select()
            .from(consumerCrawlProgress)
            .where(eq(consumerCrawlProgress.crawlId, ids.crawlId));
        expect(legacyVoucher).toBeDefined();
        expect(legacyProgress?.completedCafeIds).toEqual([ids.cafeId]);
        await db
            .update(chainPurchaseEffect)
            .set({ createdVoucherId: null, progressId: null })
            .where(eq(chainPurchaseEffect.purchaseOrderId, ids.orderId));

        await clearChainDerivedPurchaseProjections(db);
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: ids.orderId,
                txHash: replayTxHash,
                logIndex: 0,
                blockNumber: 12n,
            });
        });

        const firstReplayEffects = await db
            .select()
            .from(chainPurchaseEffect)
            .where(eq(chainPurchaseEffect.purchaseOrderId, ids.orderId));
        const [firstReplayVoucher] = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.campaignId, ids.campaignId));
        const [firstReplayProgress] = await db
            .select()
            .from(consumerCrawlProgress)
            .where(eq(consumerCrawlProgress.crawlId, ids.crawlId));
        expect(firstReplayEffects).toHaveLength(2);
        expect(firstReplayEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "campaign_qualification",
                    createdVoucherId: firstReplayVoucher?.id,
                }),
                expect.objectContaining({
                    kind: "crawl_step",
                    progressId: firstReplayProgress?.id,
                }),
            ]),
        );
        expect(firstReplayVoucher?.id).toBe(legacyVoucher?.id);
        expect(firstReplayProgress?.id).toBe(legacyProgress?.id);
        expect(firstReplayProgress?.completedCafeIds).toEqual([ids.cafeId]);

        await clearChainDerivedPurchaseProjections(db);
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: ids.orderId,
                txHash: replayTxHash,
                logIndex: 0,
                blockNumber: 12n,
            });
        });

        const secondReplayEffects = await db
            .select()
            .from(chainPurchaseEffect)
            .where(eq(chainPurchaseEffect.purchaseOrderId, ids.orderId));
        const [secondReplayVoucher] = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.campaignId, ids.campaignId));
        const [secondReplayProgress] = await db
            .select()
            .from(consumerCrawlProgress)
            .where(eq(consumerCrawlProgress.crawlId, ids.crawlId));
        expect(secondReplayEffects).toHaveLength(2);
        expect(secondReplayVoucher).toMatchObject({
            source: "campaign",
            campaignId: ids.campaignId,
            consumerUserId: ids.userId,
            status: "available",
        });
        expect(secondReplayProgress).toMatchObject({
            crawlId: ids.crawlId,
            consumerUserId: ids.userId,
            completedCafeIds: [ids.cafeId],
            status: "completed",
        });
        expect(secondReplayEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "campaign_qualification",
                    createdVoucherId: secondReplayVoucher?.id,
                }),
                expect.objectContaining({
                    kind: "crawl_step",
                    progressId: secondReplayProgress?.id,
                }),
            ]),
        );
    });

    it("removes exact auto-unlocked voucher and crawl/projection state, then replay reproduces it", async () => {
        const suffix = crypto.randomUUID();
        const userId = `rebuild-user-${suffix}`;
        const cafeId = `rebuild-cafe-${suffix}`;
        const productId = `rebuild-product-${suffix}`;
        const campaignId = `rebuild-campaign-${suffix}`;
        const manualCampaignId = `rebuild-manual-campaign-${suffix}`;
        const orderId = `rebuild-order-${suffix}`;
        const proofId = `rebuild-proof-${suffix}`;
        const manualVoucherId = `rebuild-manual-voucher-${suffix}`;
        const txHash =
            `0x${suffix.replaceAll("-", "").padStart(64, "0")}` as `0x${string}`;
        const chainCafeId = 990000 + Math.floor(Math.random() * 9000);
        fixtures.push(userId);
        await db.insert(user).values({
            id: userId,
            name: "Rebuild User",
            email: `${suffix}@rebuild.invalid`,
        });
        await db.insert(cafe).values({
            id: cafeId,
            name: "Rebuild Cafe",
            slug: suffix,
            chainCafeId,
            onboardingStatus: "approved",
        });
        await db.insert(cafeProduct).values({
            id: productId,
            cafeId,
            name: "Coffee",
            priceSoles: "8",
            type: "emission",
            approvalStatus: "approved",
            active: true,
            chainProductId: 991002,
        });
        await db.insert(campaign).values([
            {
                id: campaignId,
                kind: "verified_acquisition",
                cafeId,
                name: "Campaign",
                windowStart: new Date(Date.now() - 60_000),
                windowEnd: new Date(Date.now() + 60_000),
                active: true,
            },
            {
                id: manualCampaignId,
                kind: "verified_acquisition",
                cafeId,
                name: "Manual Campaign",
                windowStart: new Date(Date.now() - 60_000),
                windowEnd: new Date(Date.now() + 60_000),
                active: true,
            },
        ]);
        const crawlId = `rebuild-crawl-${suffix}`;
        await db.insert(coffeeCrawl).values({
            id: crawlId,
            name: "Rebuild Crawl",
            expiresAt: new Date(Date.now() + 60_000),
            active: true,
        });
        await db.insert(coffeeCrawlStep).values({
            id: `rebuild-step-${suffix}`,
            crawlId,
            stepIndex: 0,
            cafeId,
        });
        await db.insert(consumerCrawlProgress).values({
            id: `rebuild-progress-${suffix}`,
            crawlId,
            consumerUserId: userId,
            completedCafeIds: [],
            status: "in_progress",
        });
        await db.insert(consumerVoucher).values({
            id: manualVoucherId,
            source: "campaign",
            campaignId: manualCampaignId,
            consumerUserId: userId,
            cafeId,
            status: "available",
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(Date.now() - 60_000),
        });
        await db.insert(purchaseOrder).values({
            id: orderId,
            cafeId,
            userId,
            productId,
            amount: 8_000_000n,
            yapeRef: "rebuild-ref",
            receiptHash: `0x${"ab".repeat(32)}`,
            nonce: suffix,
            expiry: new Date(Date.now() + 60_000),
            status: "submitted",
        });
        await db.insert(consumptionProof).values({
            id: proofId,
            cafeId,
            productId,
            issuedByUserId: userId,
            consumerUserId: userId,
            amountCentimos: 800,
            purchaseOrderId: orderId,
            yapeRef: "rebuild-ref",
            receiptHash: `0x${"ab".repeat(32)}`,
            nonce: suffix,
            status: "submitted",
            expiresAt: new Date(Date.now() + 60_000),
        });
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId,
                txHash,
                logIndex: 0,
                blockNumber: 12n,
            });
        });
        const autoVoucher = (
            await db
                .select({ id: consumerVoucher.id })
                .from(consumerVoucher)
                .where(eq(consumerVoucher.campaignId, campaignId))
        )[0];
        expect(autoVoucher).toBeDefined();
        const [crawlVoucher] = await db
            .select({ id: consumerVoucher.id })
            .from(consumerVoucher)
            .where(eq(consumerVoucher.crawlId, crawlId));
        expect(crawlVoucher).toBeDefined();
        expect(
            await db
                .select()
                .from(chainPurchaseEffect)
                .where(eq(chainPurchaseEffect.purchaseOrderId, orderId)),
        ).toHaveLength(2);
        await clearChainDerivedPurchaseProjections(db);
        expect(
            await db
                .select()
                .from(consumerVoucher)
                .where(eq(consumerVoucher.id, autoVoucher?.id ?? "missing")),
        ).toEqual([]);
        expect(
            await db
                .select()
                .from(consumerVoucher)
                .where(eq(consumerVoucher.id, crawlVoucher?.id ?? "missing")),
        ).toEqual([]);
        expect(
            (
                await db
                    .select()
                    .from(consumerCrawlProgress)
                    .where(
                        eq(
                            consumerCrawlProgress.id,
                            `rebuild-progress-${suffix}`,
                        ),
                    )
            )[0]?.completedCafeIds,
        ).toEqual([]);
        expect(
            await db
                .select()
                .from(consumerVoucher)
                .where(eq(consumerVoucher.id, manualVoucherId)),
        ).toHaveLength(1);
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId,
                txHash,
                logIndex: 0,
                blockNumber: 12n,
            });
        });
        expect(
            await db
                .select()
                .from(consumerVoucher)
                .where(eq(consumerVoucher.campaignId, campaignId)),
        ).toHaveLength(1);
        expect(
            await db
                .select()
                .from(chainPurchaseEffect)
                .where(eq(chainPurchaseEffect.purchaseOrderId, orderId)),
        ).toHaveLength(2);
    });

    it("preserves a redeemed effect voucher and does not re-grant it on replay", async () => {
        const ids = await seedMinimalCase({ redeemAutoVoucher: true });
        const [voucherBefore] = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.campaignId, ids.campaignId));
        await clearChainDerivedPurchaseProjections(db);
        const [voucherAfter] = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.id, voucherBefore?.id ?? "missing"));
        expect(voucherAfter?.status).toBe("redeemed");
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: ids.orderId,
                txHash: `0x${"ef".repeat(32)}`,
                logIndex: 1,
                blockNumber: 13n,
            });
        });
        expect(
            await db
                .select()
                .from(consumerVoucher)
                .where(eq(consumerVoucher.campaignId, ids.campaignId)),
        ).toHaveLength(1);
    });

    it("keeps the campaign entitlement available across rebuild when a pre-existing voucher occupies the slot", async () => {
        const ids = await seedMinimalCase({ manualCampaignVoucher: true });
        await clearChainDerivedPurchaseProjections(db);
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: ids.orderId,
                txHash: ids.txHash,
                logIndex: 0,
                blockNumber: 12n,
            });
        });
        const vouchers = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.campaignId, ids.campaignId));
        expect(vouchers).toHaveLength(1);
        expect(vouchers[0]?.status).toBe("available");
    });
});

afterEach(async () => {
    for (const userId of fixtures.splice(0)) {
        const orders = await db
            .select({ id: purchaseOrder.id })
            .from(purchaseOrder)
            .where(eq(purchaseOrder.userId, userId));
        const orderIds = orders.map((row) => row.id);
        if (orderIds.length)
            await db
                .delete(consumerTransaction)
                .where(inArray(consumerTransaction.purchaseOrderId, orderIds));
        if (orderIds.length)
            await db
                .delete(chainPurchaseEffect)
                .where(inArray(chainPurchaseEffect.purchaseOrderId, orderIds));
        await db
            .delete(consumptionProof)
            .where(eq(consumptionProof.issuedByUserId, userId));
        await db.delete(purchaseOrder).where(eq(purchaseOrder.userId, userId));
        await db
            .delete(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, userId));
        await db
            .delete(punchBalanceProjection)
            .where(eq(punchBalanceProjection.userId, userId));
        await db
            .delete(consumerCrawlProgress)
            .where(eq(consumerCrawlProgress.consumerUserId, userId));
        await db
            .delete(coffeeCrawlStep)
            .where(
                eq(
                    coffeeCrawlStep.cafeId,
                    `rebuild-cafe-${userId.slice("rebuild-user-".length)}`,
                ),
            );
        await db
            .delete(coffeeCrawl)
            .where(
                eq(
                    coffeeCrawl.id,
                    `rebuild-crawl-${userId.slice("rebuild-user-".length)}`,
                ),
            );
        await db
            .delete(cafeProduct)
            .where(
                eq(
                    cafeProduct.cafeId,
                    `rebuild-cafe-${userId.slice("rebuild-user-".length)}`,
                ),
            );
        await db
            .delete(campaign)
            .where(
                inArray(campaign.cafeId, [
                    `rebuild-cafe-${userId.slice("rebuild-user-".length)}`,
                ]),
            );
        await db
            .delete(cafe)
            .where(
                eq(
                    cafe.id,
                    `rebuild-cafe-${userId.slice("rebuild-user-".length)}`,
                ),
            );
        await db.delete(user).where(eq(user.id, userId));
    }
});
