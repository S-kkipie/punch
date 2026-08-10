import { eq, inArray, like } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { applyConfirmedConsumptionProjection } from "@/core/chain/server/indexer/purchase-projection";
import { applyRewardRedeemedProjection } from "@/core/chain/server/indexer/redemption-projection";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import {
    projectionCafePayout,
    projectionCampaign,
    projectionPunchBalance,
} from "@/server/drizzle/schemas/chain-schema";
import {
    consumerTransaction,
    consumptionProof,
    redemptionRequest,
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
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import { clearChainDerivedPurchaseProjections } from "../purchase-projection-rebuild";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

const fixtures: string[] = [];

async function seedMinimalCase(options?: {
    manualCampaignVoucher?: boolean;
    crawl?: boolean;
}) {
    const suffix = crypto.randomUUID();
    const ids = {
        userId: `rebuild-user-${suffix}`,
        cafeId: `rebuild-cafe-${suffix}`,
        productId: `rebuild-product-${suffix}`,
        campaignId: `rebuild-campaign-${suffix}`,
        chainCampaignId: 980000 + Math.floor(Math.random() * 9000),
        walletAddress: `0x${suffix.replaceAll("-", "").padStart(40, "0")}`,
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
        walletAddress: ids.walletAddress,
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
        chainCampaignId: ids.chainCampaignId,
    });
    await db.insert(projectionCampaign).values({
        chainCampaignId: ids.chainCampaignId,
        status: "published",
        budget: 100n,
        voucherPayout: 10n,
        maxVouchers: 10,
        expiry: new Date(Date.now() + 60_000),
        unlockedCount: 0,
        redeemedCount: 0,
        lastBlock: 0n,
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
    return { ...ids, txHash };
}

async function seedRedemptionCase(
    status: "confirmed" | "failed" = "confirmed",
) {
    const suffix = crypto.randomUUID();
    const ids = {
        userId: `rebuild-redemption-user-${suffix}`,
        cafeId: `rebuild-redemption-cafe-${suffix}`,
        productId: `rebuild-redemption-product-${suffix}`,
        requestId: `rebuild-redemption-request-${suffix}`,
    };
    const walletAddress = `0x${suffix.replaceAll("-", "").padStart(40, "0")}`;
    const txHash = `0x${suffix.replaceAll("-", "").padStart(64, "0")}`;
    fixtures.push(ids.userId);

    await db.insert(user).values({
        id: ids.userId,
        name: "Redemption Rebuild User",
        email: `${suffix}@redemption-rebuild.invalid`,
        walletAddress,
    });
    await db.insert(cafe).values({
        id: ids.cafeId,
        name: "Redemption Rebuild Cafe",
        slug: `redemption-${suffix}`,
        chainCafeId: 992000 + Math.floor(Math.random() * 9000),
        onboardingStatus: "approved",
    });
    await db.insert(cafeProduct).values({
        id: ids.productId,
        cafeId: ids.cafeId,
        name: "Redemption Coffee",
        priceSoles: "12.00",
        type: "reward",
        approvalStatus: "approved",
        active: true,
        chainProductId: 992002,
    });
    await db.insert(redemptionRequest).values({
        id: ids.requestId,
        kind: "punch_reward",
        consumerUserId: ids.userId,
        cafeId: ids.cafeId,
        productId: ids.productId,
        status,
        failureReason: status === "failed" ? "permanent revert" : null,
    });
    await db.insert(relayerJob).values({
        id: `rebuild-redemption-job-${suffix}`,
        kind: "punch_redemption",
        redemptionRequestId: ids.requestId,
        payload: {
            userWallet: walletAddress,
            chainCafeId:
                (
                    await db
                        .select({ chainCafeId: cafe.chainCafeId })
                        .from(cafe)
                        .where(eq(cafe.id, ids.cafeId))
                )[0]?.chainCafeId ?? 0,
            chainProductId: 992002,
        },
        status: status === "confirmed" ? "confirmed" : "failed",
        txHash,
    });
    await db.insert(projectionPunchBalance).values({
        userAddress: walletAddress,
        balance: 12n,
        lastBlock: 20n,
    });
    if (status === "confirmed") {
        await db.insert(consumerTransaction).values({
            id: `chain_redemption:${ids.requestId}`,
            operation: "punch_redemption",
            consumerUserId: ids.userId,
            cafeId: ids.cafeId,
            redemptionRequestId: ids.requestId,
            chainTxId: txHash,
            status: "confirmed",
            idempotencyKey: `chain_redemption:${ids.requestId}`,
            transactionHash: txHash,
            chainBlockNumber: 20n,
            logIndex: 0,
            modeledHostPayoutCentimos: 360,
        });
        await db.insert(projectionCafePayout).values({
            cafeId: ids.cafeId,
            totalCentimos: 360,
            redemptionCount: 1,
        });
    }
    return {
        ...ids,
        chainCafeId:
            (
                await db
                    .select({ chainCafeId: cafe.chainCafeId })
                    .from(cafe)
                    .where(eq(cafe.id, ids.cafeId))
            )[0]?.chainCafeId ?? 0,
        walletAddress,
        txHash,
    };
}

describeIntegration("clearChainDerivedPurchaseProjections", () => {
    it("records no crawl effect for a repeat purchase after the crawl is complete", async () => {
        const ids = await seedMinimalCase({ crawl: true });
        const suffix = crypto.randomUUID();
        const revisitOrderId = `rebuild-revisit-${suffix}`;
        await db.insert(purchaseOrder).values({
            id: revisitOrderId,
            cafeId: ids.cafeId,
            userId: ids.userId,
            productId: ids.productId,
            amount: 8_000_000n,
            yapeRef: "revisit-ref",
            receiptHash: `0x${"cd".repeat(32)}`,
            nonce: suffix,
            expiry: new Date(Date.now() + 60_000),
            status: "submitted",
        });
        await db.insert(consumptionProof).values({
            id: `rebuild-revisit-proof-${suffix}`,
            cafeId: ids.cafeId,
            productId: ids.productId,
            issuedByUserId: ids.userId,
            consumerUserId: ids.userId,
            amountCentimos: 800,
            purchaseOrderId: revisitOrderId,
            yapeRef: "revisit-ref",
            receiptHash: `0x${"cd".repeat(32)}`,
            nonce: suffix,
            status: "submitted",
            expiresAt: new Date(Date.now() + 60_000),
        });
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: revisitOrderId,
                txHash: `0x${suffix.replaceAll("-", "").padStart(64, "0")}` as `0x${string}`,
                logIndex: 0,
                blockNumber: 13n,
            });
        });
        const revisitEffects = await db
            .select()
            .from(chainPurchaseEffect)
            .where(eq(chainPurchaseEffect.purchaseOrderId, revisitOrderId));
        expect(
            revisitEffects.filter((effect) => effect.kind === "crawl_step"),
        ).toEqual([]);
        const vouchers = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.crawlId, ids.crawlId));
        expect(vouchers).toHaveLength(1);
    });

    it("self-heals legacy effect provenance and converges on the next rebuild", async () => {
        const ids = await seedMinimalCase({ crawl: true });
        const replayTxHash =
            `0x${crypto.randomUUID().replaceAll("-", "").padStart(64, "0")}` as `0x${string}`;
        const [legacyProgress] = await db
            .select()
            .from(consumerCrawlProgress)
            .where(eq(consumerCrawlProgress.crawlId, ids.crawlId));
        expect(
            await db
                .select()
                .from(consumerVoucher)
                .where(eq(consumerVoucher.campaignId, ids.campaignId)),
        ).toHaveLength(0);
        expect(legacyProgress?.completedCafeIds).toEqual([ids.cafeId]);
        await db
            .update(chainPurchaseEffect)
            .set({ progressId: null })
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
        const firstReplayVouchers = await db
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
                    createdVoucherId: null,
                }),
                expect.objectContaining({
                    kind: "crawl_step",
                    progressId: firstReplayProgress?.id,
                }),
            ]),
        );
        expect(firstReplayVouchers).toHaveLength(0);
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
        const secondReplayVouchers = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.campaignId, ids.campaignId));
        const [secondReplayProgress] = await db
            .select()
            .from(consumerCrawlProgress)
            .where(eq(consumerCrawlProgress.crawlId, ids.crawlId));
        expect(secondReplayEffects).toHaveLength(2);
        expect(secondReplayVouchers).toHaveLength(0);
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
                    createdVoucherId: null,
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
        const campaignChainId = 985000 + Math.floor(Math.random() * 9000);
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
            walletAddress: `0x${suffix.replaceAll("-", "").padStart(40, "0")}`,
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
                chainCampaignId: campaignChainId,
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
        await db.insert(projectionCampaign).values({
            chainCampaignId: campaignChainId,
            status: "published",
            budget: 100n,
            voucherPayout: 10n,
            maxVouchers: 10,
            expiry: new Date(Date.now() + 60_000),
            unlockedCount: 0,
            redeemedCount: 0,
            lastBlock: 0n,
        });
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
        expect(
            await db
                .select()
                .from(consumerVoucher)
                .where(eq(consumerVoucher.campaignId, campaignId)),
        ).toHaveLength(0);
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
                .where(eq(consumerVoucher.campaignId, campaignId)),
        ).toHaveLength(0);
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
        ).toHaveLength(0);
        expect(
            await db
                .select()
                .from(chainPurchaseEffect)
                .where(eq(chainPurchaseEffect.purchaseOrderId, orderId)),
        ).toHaveLength(2);
    });

    it("preserves a redeemed chain-projected voucher and does not re-grant it on replay", async () => {
        const ids = await seedMinimalCase();
        const [voucherBefore] = await db
            .insert(consumerVoucher)
            .values({
                source: "campaign",
                campaignId: ids.campaignId,
                consumerUserId: ids.userId,
                cafeId: ids.cafeId,
                status: "redeemed",
                redeemedAt: new Date(),
                chainUnlockTxHash: `0x${"aa".repeat(32)}`,
                expiresAt: new Date(Date.now() + 60_000),
            })
            .returning();
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

    it("leaves confirmed voucher requests and ledgers unchanged", async () => {
        const ids = await seedMinimalCase();
        const [voucher] = await db
            .insert(consumerVoucher)
            .values({
                source: "campaign",
                campaignId: ids.campaignId,
                consumerUserId: ids.userId,
                cafeId: ids.cafeId,
                status: "redeemed",
                redeemedAt: new Date(),
                chainUnlockTxHash: `0x${"bb".repeat(32)}`,
                expiresAt: new Date(Date.now() + 60_000),
            })
            .returning();
        await db
            .update(consumerVoucher)
            .set({ status: "redeemed", redeemedAt: new Date() })
            .where(eq(consumerVoucher.id, voucher.id));
        const requestId = `rebuild-voucher-request-${crypto.randomUUID()}`;
        const transactionId = `rebuild-voucher-transaction-${crypto.randomUUID()}`;
        await db.insert(redemptionRequest).values({
            id: requestId,
            kind: "voucher",
            consumerUserId: ids.userId,
            cafeId: ids.cafeId,
            voucherId: voucher.id,
            status: "confirmed",
        });
        await db.insert(consumerTransaction).values({
            id: transactionId,
            operation: "voucher_redemption",
            consumerUserId: ids.userId,
            cafeId: ids.cafeId,
            redemptionRequestId: requestId,
            chainTxId: `mock:voucher:${requestId}`,
            status: "confirmed",
            idempotencyKey: `voucher_redemption:${requestId}`,
        });

        await clearChainDerivedPurchaseProjections(db);

        expect(
            (
                await db
                    .select()
                    .from(redemptionRequest)
                    .where(eq(redemptionRequest.id, requestId))
            )[0]?.status,
        ).toBe("confirmed");
        expect(
            await db
                .select()
                .from(consumerTransaction)
                .where(eq(consumerTransaction.id, transactionId)),
        ).toHaveLength(1);
    });

    it("clear preserves confirmed redemption state while clearing chain projections", async () => {
        const ids = await seedRedemptionCase();

        await clearChainDerivedPurchaseProjections(db);

        expect(
            (
                await db
                    .select()
                    .from(redemptionRequest)
                    .where(eq(redemptionRequest.id, ids.requestId))
            )[0]?.status,
        ).toBe("confirmed");
        expect(
            await db
                .select()
                .from(consumerTransaction)
                .where(
                    eq(
                        consumerTransaction.idempotencyKey,
                        `chain_redemption:${ids.requestId}`,
                    ),
                ),
        ).toEqual([]);
        expect(
            await db
                .select()
                .from(projectionCafePayout)
                .where(eq(projectionCafePayout.cafeId, ids.cafeId)),
        ).toEqual([]);
        expect(
            await db
                .select()
                .from(projectionPunchBalance)
                .where(
                    eq(projectionPunchBalance.userAddress, ids.walletAddress),
                ),
        ).toEqual([]);

        await db.transaction(async (tx) => {
            await applyRewardRedeemedProjection(tx, {
                userAddress: ids.walletAddress,
                chainCafeId: ids.chainCafeId,
                txHash: ids.txHash,
                logIndex: 0,
                blockNumber: 20n,
            });
        });

        expect(
            (
                await db
                    .select()
                    .from(redemptionRequest)
                    .where(eq(redemptionRequest.id, ids.requestId))
            )[0]?.status,
        ).toBe("confirmed");
        expect(
            await db
                .select()
                .from(consumerTransaction)
                .where(
                    eq(
                        consumerTransaction.idempotencyKey,
                        `chain_redemption:${ids.requestId}`,
                    ),
                ),
        ).toHaveLength(1);
        expect(
            await db
                .select()
                .from(projectionCafePayout)
                .where(eq(projectionCafePayout.cafeId, ids.cafeId)),
        ).toMatchObject([{ totalCentimos: 360, redemptionCount: 1 }]);
    });

    it("replays multiple historical confirmed PUNCH requests without reopening them", async () => {
        const first = await seedRedemptionCase();
        const suffix = crypto.randomUUID();
        const secondProductId = `rebuild-redemption-product-2-${suffix}`;
        const secondRequestId = `rebuild-redemption-request-2-${suffix}`;
        const secondTxHash = `0x${suffix.replaceAll("-", "").padStart(64, "0")}`;
        await db.insert(cafeProduct).values({
            id: secondProductId,
            cafeId: first.cafeId,
            name: "Second Redemption Coffee",
            priceSoles: "12.00",
            type: "reward",
            approvalStatus: "approved",
            active: true,
            chainProductId: 992003,
        });
        await db.insert(redemptionRequest).values({
            id: secondRequestId,
            kind: "punch_reward",
            consumerUserId: first.userId,
            cafeId: first.cafeId,
            productId: secondProductId,
            status: "confirmed",
        });
        await db.insert(relayerJob).values({
            id: `rebuild-redemption-job-2-${suffix}`,
            kind: "punch_redemption",
            redemptionRequestId: secondRequestId,
            payload: {
                userWallet: first.walletAddress,
                chainCafeId: first.chainCafeId,
                chainProductId: 992003,
            },
            status: "confirmed",
            txHash: secondTxHash,
        });
        await db.insert(consumerTransaction).values({
            id: `chain_redemption:${secondRequestId}`,
            operation: "punch_redemption",
            consumerUserId: first.userId,
            cafeId: first.cafeId,
            redemptionRequestId: secondRequestId,
            chainTxId: secondTxHash,
            status: "confirmed",
            idempotencyKey: `chain_redemption:${secondRequestId}`,
            transactionHash: secondTxHash,
            chainBlockNumber: 21n,
            logIndex: 0,
            modeledHostPayoutCentimos: 360,
        });
        await db
            .update(projectionCafePayout)
            .set({ totalCentimos: 720, redemptionCount: 2 })
            .where(eq(projectionCafePayout.cafeId, first.cafeId));

        await clearChainDerivedPurchaseProjections(db);
        const afterClear = await db
            .select({
                id: redemptionRequest.id,
                status: redemptionRequest.status,
            })
            .from(redemptionRequest)
            .where(
                inArray(redemptionRequest.id, [
                    first.requestId,
                    secondRequestId,
                ]),
            );
        expect(afterClear).toEqual(
            expect.arrayContaining([
                { id: first.requestId, status: "confirmed" },
                { id: secondRequestId, status: "confirmed" },
            ]),
        );

        await db.transaction(async (tx) => {
            await applyRewardRedeemedProjection(tx, {
                userAddress: first.walletAddress,
                chainCafeId: first.chainCafeId,
                chainProductId: 992002,
                txHash: first.txHash,
                logIndex: 0,
                blockNumber: 20n,
            });
            await applyRewardRedeemedProjection(tx, {
                userAddress: first.walletAddress,
                chainCafeId: first.chainCafeId,
                chainProductId: 992003,
                txHash: secondTxHash,
                logIndex: 0,
                blockNumber: 21n,
            });
        });

        expect(
            await db
                .select()
                .from(consumerTransaction)
                .where(
                    inArray(consumerTransaction.redemptionRequestId, [
                        first.requestId,
                        secondRequestId,
                    ]),
                ),
        ).toHaveLength(2);
        expect(
            await db
                .select()
                .from(projectionCafePayout)
                .where(eq(projectionCafePayout.cafeId, first.cafeId)),
        ).toMatchObject([{ totalCentimos: 720, redemptionCount: 2 }]);
    });

    it("failed redemption requests survive the clear untouched", async () => {
        const ids = await seedRedemptionCase("failed");

        await clearChainDerivedPurchaseProjections(db);

        expect(
            (
                await db
                    .select()
                    .from(redemptionRequest)
                    .where(eq(redemptionRequest.id, ids.requestId))
            )[0],
        ).toMatchObject({
            status: "failed",
            failureReason: "permanent revert",
        });
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
        await db
            .delete(consumerTransaction)
            .where(eq(consumerTransaction.consumerUserId, userId));
        await db.delete(relayerJob).where(
            inArray(
                relayerJob.redemptionRequestId,
                (
                    await db
                        .select({ id: redemptionRequest.id })
                        .from(redemptionRequest)
                        .where(eq(redemptionRequest.consumerUserId, userId))
                ).map((request) => request.id),
            ),
        );
        await db
            .delete(redemptionRequest)
            .where(eq(redemptionRequest.consumerUserId, userId));
        await db
            .delete(projectionCafePayout)
            .where(
                eq(
                    projectionCafePayout.cafeId,
                    `rebuild-redemption-cafe-${userId.slice("rebuild-redemption-user-".length)}`,
                ),
            );
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
        const campaignRows = await db
            .select({ chainCampaignId: campaign.chainCampaignId })
            .from(campaign)
            .where(
                inArray(campaign.cafeId, [
                    `rebuild-cafe-${userId.slice("rebuild-user-".length)}`,
                ]),
            );
        for (const row of campaignRows) {
            if (row.chainCampaignId !== null) {
                await db
                    .delete(relayerJob)
                    .where(
                        like(
                            relayerJob.idempotencyKey,
                            `voucher_unlock:${row.chainCampaignId}:%`,
                        ),
                    );
                await db
                    .delete(projectionCampaign)
                    .where(
                        eq(
                            projectionCampaign.chainCampaignId,
                            row.chainCampaignId,
                        ),
                    );
            }
        }
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
