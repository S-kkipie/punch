import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { applyConfirmedConsumptionProjection } from "@/core/chain/server/indexer/purchase-projection";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";
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
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

const txHash = (n: number) =>
    `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

type Fixture = {
    userId: string;
    cafeIds: string[];
    productIds: string[];
    orderIds: string[];
    proofIds: string[];
    campaignId?: string;
    chainCampaignId?: number;
    unlockJobKeys: string[];
    crawlId?: string;
};
const fixtures: Fixture[] = [];

async function fixture(cafeCount = 3): Promise<Fixture> {
    const suffix = crypto.randomUUID();
    const f: Fixture = {
        userId: `effects-user-${suffix}`,
        cafeIds: [],
        productIds: [],
        orderIds: [],
        proofIds: [],
        unlockJobKeys: [],
    };
    await db.insert(user).values({
        id: f.userId,
        name: "Effects Integration User",
        email: `${suffix}@effects.invalid`,
        walletAddress: "0x1111111111111111111111111111111111111111",
    });
    for (let i = 0; i < cafeCount; i++) {
        const cafeId = `effects-cafe-${suffix}-${i}`;
        const productId = `effects-product-${suffix}-${i}`;
        f.cafeIds.push(cafeId);
        f.productIds.push(productId);
        await db.insert(cafe).values({
            id: cafeId,
            name: `Effects Café ${i}`,
            slug: `effects-${suffix}-${i}`,
            chainCafeId: 910000 + Math.floor(Math.random() * 8000),
            onboardingStatus: "approved",
        });
        await db.insert(cafeProduct).values({
            id: productId,
            cafeId,
            name: `Effects Product ${i}`,
            priceSoles: "8",
            type: "emission",
            approvalStatus: "approved",
            active: true,
            chainProductId: 920000 + Math.floor(Math.random() * 8000),
        });
    }
    fixtures.push(f);
    return f;
}

function campaignChainId(f: Fixture): number {
    if (f.chainCampaignId !== undefined) return f.chainCampaignId;
    const hex = f.userId.replace("effects-user-", "").replaceAll("-", "");
    f.chainCampaignId =
        (Number.parseInt(hex.slice(0, 8), 16) % 2_147_483_646) + 1;
    return f.chainCampaignId;
}

function unlockKey(f: Fixture): string {
    const key = `voucher_unlock:${campaignChainId(f)}:0x1111111111111111111111111111111111111111`;
    if (!f.unlockJobKeys.includes(key)) f.unlockJobKeys.push(key);
    return key;
}

async function order(f: Fixture, index: number, suffix = "") {
    const orderId = `effects-order-${f.userId}-${index}-${suffix}`;
    const proofId = `effects-proof-${f.userId}-${index}-${suffix}`;
    f.orderIds.push(orderId);
    f.proofIds.push(proofId);
    const receiptHash = `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
    await db.insert(purchaseOrder).values({
        id: orderId,
        cafeId: f.cafeIds[index],
        userId: f.userId,
        productId: f.productIds[index],
        amount: 8_000_000n,
        yapeRef: `effects-${orderId}`,
        receiptHash,
        nonce: `${index}-${suffix}`,
        expiry: new Date(Date.now() + 60_000),
        status: "submitted",
    });
    await db.insert(consumptionProof).values({
        id: proofId,
        cafeId: f.cafeIds[index],
        productId: f.productIds[index],
        issuedByUserId: f.userId,
        consumerUserId: f.userId,
        amountCentimos: 800,
        purchaseOrderId: orderId,
        yapeRef: `effects-${orderId}`,
        receiptHash,
        nonce: `${index}-${suffix}`,
        status: "submitted",
        expiresAt: new Date(Date.now() + 60_000),
    });
    return { orderId, proofId };
}

async function projectWithOptions(
    orderId: string,
    eventNumber: number,
    confirmedAt?: Date,
) {
    await db.transaction(async (tx) => {
        await applyConfirmedConsumptionProjection(tx, {
            orderId,
            txHash: txHash(eventNumber),
            logIndex: eventNumber,
            blockNumber: BigInt(eventNumber),
            confirmedAt,
        });
    });
}

async function project(
    f: Fixture,
    index: number,
    eventNumber: number,
    suffix = "",
) {
    const created = await order(f, index, suffix);
    await db.transaction(async (tx) => {
        await applyConfirmedConsumptionProjection(tx, {
            orderId: created.orderId,
            txHash: txHash(eventNumber),
            logIndex: eventNumber,
            blockNumber: BigInt(eventNumber),
        });
    });
    return created;
}

async function cleanup() {
    for (const f of fixtures.splice(0)) {
        await db
            .delete(consumerCrawlProgress)
            .where(eq(consumerCrawlProgress.consumerUserId, f.userId));
        await db
            .delete(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, f.userId));
        await db
            .delete(consumerTransaction)
            .where(eq(consumerTransaction.consumerUserId, f.userId));
        await db
            .delete(chainPurchaseEffect)
            .where(inArray(chainPurchaseEffect.purchaseOrderId, f.orderIds));
        if (f.unlockJobKeys.length > 0)
            await db
                .delete(relayerJob)
                .where(inArray(relayerJob.idempotencyKey, f.unlockJobKeys));
        if (f.chainCampaignId !== undefined)
            await db
                .delete(projectionCampaign)
                .where(
                    eq(projectionCampaign.chainCampaignId, f.chainCampaignId),
                );
        await db
            .delete(consumptionProof)
            .where(eq(consumptionProof.issuedByUserId, f.userId));
        await db
            .delete(purchaseOrder)
            .where(eq(purchaseOrder.userId, f.userId));
        if (f.campaignId)
            await db.delete(campaign).where(eq(campaign.id, f.campaignId));
        if (f.crawlId) {
            await db
                .delete(coffeeCrawlStep)
                .where(eq(coffeeCrawlStep.crawlId, f.crawlId));
            await db.delete(coffeeCrawl).where(eq(coffeeCrawl.id, f.crawlId));
        }
        await db
            .delete(punchBalanceProjection)
            .where(eq(punchBalanceProjection.userId, f.userId));
        await db
            .delete(cafeProduct)
            .where(inArray(cafeProduct.id, f.productIds));
        await db.delete(cafe).where(inArray(cafe.id, f.cafeIds));
        await db.delete(user).where(eq(user.id, f.userId));
    }
}

afterEach(async () => {
    if (runIntegration) await cleanup();
});

describeIntegration("indexed purchase effects", () => {
    it("enqueues one unlock job and no voucher exactly once on replay", async () => {
        const f = await fixture(1);
        const chainCampaignId = campaignChainId(f);
        const [createdCampaign] = await db
            .insert(campaign)
            .values({
                id: `effects-campaign-${f.userId}`,
                kind: "verified_acquisition",
                cafeId: f.cafeIds[0],
                name: "Target Café Acquisition",
                windowStart: new Date(Date.now() - 60_000),
                windowEnd: new Date(Date.now() + 60_000),
                active: true,
                chainCampaignId: chainCampaignId,
            })
            .returning();
        f.campaignId = createdCampaign.id;
        await db.insert(projectionCampaign).values({
            chainCampaignId: chainCampaignId,
            status: "published",
            budget: 1000n,
            voucherPayout: 1n,
            maxVouchers: 10,
            expiry: new Date(Date.now() + 60_000),
            unlockedCount: 0,
            redeemedCount: 0,
            lastBlock: 0n,
        });
        const created = await project(f, 0, 1);
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: created.orderId,
                txHash: txHash(1),
                logIndex: 1,
                blockNumber: 1n,
            });
        });
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: created.orderId,
                txHash: txHash(1),
                logIndex: 1,
                blockNumber: 1n,
            });
        });
        const vouchers = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, f.userId));
        const jobs = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.idempotencyKey, unlockKey(f)));
        const history = await db
            .select()
            .from(consumerTransaction)
            .where(eq(consumerTransaction.purchaseOrderId, created.orderId));
        expect(vouchers).toHaveLength(0);
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({
            kind: "voucher_unlock",
            status: "pending",
            payload: {
                chainCampaignId: chainCampaignId,
                userAddress: "0x1111111111111111111111111111111111111111",
                effectId: expect.any(String),
            },
        });
        expect(history).toHaveLength(1);
    });

    it("enqueues only one unlock job when confirmations arrive out of submission order", async () => {
        const f = await fixture(1);
        const chainCampaignId = campaignChainId(f);
        const [campaignRow] = await db
            .insert(campaign)
            .values({
                id: `effects-campaign-${f.userId}`,
                kind: "verified_acquisition",
                cafeId: f.cafeIds[0],
                name: "Out of order",
                windowStart: new Date(Date.now() - 60_000),
                windowEnd: new Date(Date.now() + 60_000),
                active: true,
                chainCampaignId: chainCampaignId,
            })
            .returning();
        f.campaignId = campaignRow.id;
        await db.insert(projectionCampaign).values({
            chainCampaignId: chainCampaignId,
            status: "published",
            budget: 1000n,
            voucherPayout: 1n,
            maxVouchers: 10,
            expiry: new Date(Date.now() + 60_000),
            unlockedCount: 0,
            redeemedCount: 0,
            lastBlock: 0n,
        });
        const submittedFirst = await order(f, 0, "submitted-first");
        const confirmedFirst = await order(f, 0, "confirmed-first");
        await db
            .update(purchaseOrder)
            .set({ updatedAt: new Date(Date.now() - 120_000) })
            .where(eq(purchaseOrder.id, submittedFirst.orderId));
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: confirmedFirst.orderId,
                txHash: txHash(20),
                logIndex: 20,
                blockNumber: 20n,
            });
        });
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: submittedFirst.orderId,
                txHash: txHash(21),
                logIndex: 21,
                blockNumber: 21n,
            });
        });
        const vouchers = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, f.userId));
        const jobs = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.idempotencyKey, unlockKey(f)));
        expect(vouchers).toHaveLength(0);
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({
            status: "pending",
            idempotencyKey: unlockKey(f),
            payload: {
                chainCampaignId: chainCampaignId,
                userAddress: "0x1111111111111111111111111111111111111111",
                effectId: expect.any(String),
            },
        });
    });

    it("uses chain order when same-millisecond confirmations disagree with ids", async () => {
        const f = await fixture(1);
        const chainCampaignId = campaignChainId(f);
        const [campaignRow] = await db
            .insert(campaign)
            .values({
                id: `effects-campaign-${f.userId}`,
                kind: "verified_acquisition",
                cafeId: f.cafeIds[0],
                name: "Chain order",
                windowStart: new Date(Date.now() - 60_000),
                windowEnd: new Date(Date.now() + 60_000),
                active: true,
                chainCampaignId: chainCampaignId,
            })
            .returning();
        f.campaignId = campaignRow.id;
        await db.insert(projectionCampaign).values({
            chainCampaignId: chainCampaignId,
            status: "published",
            budget: 1000n,
            voucherPayout: 1n,
            maxVouchers: 10,
            expiry: new Date(Date.now() + 60_000),
            unlockedCount: 0,
            redeemedCount: 0,
            lastBlock: 0n,
        });
        const firstOnChain = await order(f, 0, "a");
        const secondOnChain = await order(f, 0, "b");
        const confirmedAt = new Date();
        await projectWithOptions(firstOnChain.orderId, 200, confirmedAt);
        await projectWithOptions(secondOnChain.orderId, 201, confirmedAt);
        const effects = await db
            .select()
            .from(chainPurchaseEffect)
            .where(eq(chainPurchaseEffect.kind, "campaign_qualification"));
        expect(effects).toHaveLength(1);
        expect(effects[0].purchaseOrderId).toBe(firstOnChain.orderId);
        const jobs = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.idempotencyKey, unlockKey(f)));
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({
            status: "pending",
            idempotencyKey: unlockKey(f),
            payload: {
                chainCampaignId: chainCampaignId,
                userAddress: "0x1111111111111111111111111111111111111111",
                effectId: expect.any(String),
            },
        });
    });

    it("advances an ordered A to B to C crawl once per café and ignores repeats", async () => {
        const f = await fixture(3);
        const [crawl] = await db
            .insert(coffeeCrawl)
            .values({
                id: `effects-crawl-${f.userId}`,
                name: "A B C",
                expiresAt: new Date(Date.now() + 60_000),
                active: true,
            })
            .returning();
        f.crawlId = crawl.id;
        await db.insert(coffeeCrawlStep).values(
            f.cafeIds.map((cafeId, stepIndex) => ({
                id: `effects-step-${f.userId}-${stepIndex}`,
                crawlId: crawl.id,
                stepIndex,
                cafeId,
            })),
        );
        await project(f, 0, 2, "a");
        await project(f, 1, 3, "b");
        await project(f, 1, 4, "repeat-b");
        await project(f, 2, 5, "c");
        const [progress] = await db
            .select()
            .from(consumerCrawlProgress)
            .where(
                and(
                    eq(consumerCrawlProgress.crawlId, crawl.id),
                    eq(consumerCrawlProgress.consumerUserId, f.userId),
                ),
            );
        const effects = await db
            .select()
            .from(chainPurchaseEffect)
            .where(
                and(
                    eq(chainPurchaseEffect.kind, "crawl_step"),
                    eq(chainPurchaseEffect.purchaseOrderId, f.orderIds[0]),
                ),
            );
        const allEffects = await db
            .select()
            .from(chainPurchaseEffect)
            .where(inArray(chainPurchaseEffect.purchaseOrderId, f.orderIds));
        expect(progress.completedCafeIds).toEqual(f.cafeIds);
        expect(
            allEffects.filter((effect) => effect.kind === "crawl_step"),
        ).toHaveLength(3);
        expect(effects).toHaveLength(1);
    });

    it("does not apply wrong-café, expired, or already-qualified purchases", async () => {
        const f = await fixture(2);
        const [campaignRow] = await db
            .insert(campaign)
            .values({
                id: `effects-campaign-${f.userId}`,
                kind: "verified_acquisition",
                cafeId: f.cafeIds[0],
                name: "Expired",
                windowStart: new Date(Date.now() - 120_000),
                windowEnd: new Date(Date.now() - 60_000),
                active: true,
            })
            .returning();
        f.campaignId = campaignRow.id;
        await project(f, 0, 6, "first");
        await project(f, 0, 7, "already");
        await project(f, 1, 8, "wrong");
        const vouchers = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, f.userId));
        const effects = await db
            .select()
            .from(chainPurchaseEffect)
            .where(inArray(chainPurchaseEffect.purchaseOrderId, f.orderIds));
        expect(vouchers).toHaveLength(0);
        expect(
            effects.filter(
                (effect) => effect.kind === "campaign_qualification",
            ),
        ).toHaveLength(0);
    });

    it("replaying from block zero preserves projections and vouchers without changing PUNCH", async () => {
        const f = await fixture(1);
        const [campaignRow] = await db
            .insert(campaign)
            .values({
                id: `effects-campaign-${f.userId}`,
                kind: "verified_acquisition",
                cafeId: f.cafeIds[0],
                name: "Replay",
                windowStart: new Date(Date.now() - 60_000),
                windowEnd: new Date(Date.now() + 60_000),
                active: true,
            })
            .returning();
        f.campaignId = campaignRow.id;
        const created = await project(f, 0, 9, "reindex");
        const before = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, f.userId));
        const beforeHistory = await db
            .select()
            .from(consumerTransaction)
            .where(eq(consumerTransaction.purchaseOrderId, created.orderId));
        const beforeBalance = await db
            .select()
            .from(punchBalanceProjection)
            .where(eq(punchBalanceProjection.userId, f.userId));
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId: created.orderId,
                txHash: txHash(9),
                logIndex: 9,
                blockNumber: 9n,
            });
        });
        const after = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, f.userId));
        const afterHistory = await db
            .select()
            .from(consumerTransaction)
            .where(eq(consumerTransaction.purchaseOrderId, created.orderId));
        const afterBalance = await db
            .select()
            .from(punchBalanceProjection)
            .where(eq(punchBalanceProjection.userId, f.userId));
        expect(after).toHaveLength(before.length);
        expect(afterHistory).toHaveLength(beforeHistory.length);
        expect(afterBalance).toEqual(beforeBalance);
    });
});
