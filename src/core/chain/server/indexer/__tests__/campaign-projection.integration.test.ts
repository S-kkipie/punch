import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";
import {
    campaign,
    chainPurchaseEffect,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import { applyCampaignEvent } from "../campaign-projection";

const describeIntegration = describe.skipIf(
    process.env.PUNCH_RUN_INTEGRATION !== "1",
);
const ids = {
    cafe: "campaign-projection-test-cafe",
    product: "campaign-projection-test-product",
    campaign: "campaign-projection-test-campaign",
    user1: "campaign-projection-test-user-1",
    user2: "campaign-projection-test-user-2",
    order: "campaign-projection-test-order",
    effect: "campaign-projection-test-effect",
};
const wallet1 = "0x0000000000000000000000000000000000000001";
const wallet2 = "0x0000000000000000000000000000000000000002";
const base = {
    transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    transactionIndex: 0,
};

async function seed() {
    await db.insert(user).values([
        {
            id: ids.user1,
            name: "Campaign User 1",
            email: "campaign-user-1@test.invalid",
            walletIndex: 9901,
            walletAddress: wallet1,
        },
        {
            id: ids.user2,
            name: "Campaign User 2",
            email: "campaign-user-2@test.invalid",
            walletIndex: 9902,
            walletAddress: wallet2,
        },
    ]);
    await db.insert(cafe).values({
        id: ids.cafe,
        name: "Campaign Test Cafe",
        slug: ids.cafe,
        chainCafeId: 9001,
        onboardingStatus: "approved",
    });
    await db.insert(cafeProduct).values({
        id: ids.product,
        cafeId: ids.cafe,
        name: "Campaign Product",
        priceSoles: "1",
        type: "emission",
        approvalStatus: "approved",
        active: true,
    });
    await db.insert(campaign).values({
        id: ids.campaign,
        kind: "verified_acquisition",
        cafeId: ids.cafe,
        name: "Campaign Test",
        windowStart: new Date(0),
        windowEnd: new Date("2030-01-01"),
        chainCampaignId: 9001,
    });
    await db.insert(purchaseOrder).values({
        id: ids.order,
        cafeId: ids.cafe,
        userId: ids.user1,
        productId: ids.product,
        amount: 1n,
        yapeRef: ids.order,
        receiptHash: ids.order,
        nonce: "1",
        expiry: new Date("2030-01-01"),
    });
    await db.insert(chainPurchaseEffect).values({
        id: ids.effect,
        purchaseOrderId: ids.order,
        kind: "campaign_qualification",
        targetId: ids.campaign,
        transactionHash: base.transactionHash,
        logIndex: 0,
    });
    await db.insert(projectionCampaign).values({
        chainCampaignId: 9001,
        status: "draft",
        budget: 0n,
        voucherPayout: 10n,
        maxVouchers: 10,
        expiry: new Date("2030-01-01"),
        unlockedCount: 0,
        redeemedCount: 0,
        lastBlock: 1n,
    });
}

async function cleanup() {
    await db
        .delete(chainPurchaseEffect)
        .where(eq(chainPurchaseEffect.id, ids.effect));
    await db
        .delete(consumerVoucher)
        .where(inArray(consumerVoucher.consumerUserId, [ids.user1, ids.user2]));
    await db.delete(purchaseOrder).where(eq(purchaseOrder.id, ids.order));
    await db
        .delete(projectionCampaign)
        .where(eq(projectionCampaign.chainCampaignId, 9001));
    await db.delete(campaign).where(eq(campaign.id, ids.campaign));
    await db.delete(cafeProduct).where(eq(cafeProduct.id, ids.product));
    await db.delete(cafe).where(eq(cafe.id, ids.cafe));
    await db.delete(user).where(inArray(user.id, [ids.user1, ids.user2]));
}

describeIntegration("campaign projection integration", () => {
    afterEach(cleanup);

    it("projects CampaignFunded and CampaignPublished", async () => {
        await seed();
        await applyCampaignEvent(db, {
            ...base,
            blockNumber: 2n,
            logIndex: 0,
            eventName: "CampaignFunded",
            args: { campaignId: 9001n, amount: 100n },
        });
        await applyCampaignEvent(db, {
            ...base,
            blockNumber: 2n,
            logIndex: 1,
            eventName: "CampaignPublished",
            args: {
                campaignId: 9001n,
                voucherPayout: 10n,
                maxVouchers: 5n,
                expiry: 1_893_456_000n,
            },
        });
        const [row] = await db.select().from(projectionCampaign);
        expect(row).toMatchObject({
            budget: 100n,
            status: "published",
            voucherPayout: 10n,
            maxVouchers: 5,
        });
    });

    it("projects the complete VoucherUnlocked write", async () => {
        await seed();
        await applyCampaignEvent(db, {
            ...base,
            blockNumber: 2n,
            logIndex: 0,
            eventName: "VoucherUnlocked",
            args: { campaignId: 9001n, user: wallet1 },
        });
        const [row] = await db.select().from(projectionCampaign);
        const [voucher] = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, ids.user1));
        const [effect] = await db
            .select()
            .from(chainPurchaseEffect)
            .where(eq(chainPurchaseEffect.id, ids.effect));
        expect(row.unlockedCount).toBe(1);
        expect(voucher).toMatchObject({
            source: "campaign",
            chainUnlockTxHash: base.transactionHash,
            campaignId: ids.campaign,
        });
        expect(effect.createdVoucherId).toBe(voucher.id);
    });

    it("accepts two same-block unlocks and rejects an identical replay", async () => {
        await seed();
        const first = {
            ...base,
            blockNumber: 2n,
            logIndex: 0,
            eventName: "VoucherUnlocked" as const,
            args: { campaignId: 9001n, user: wallet1 },
        };
        const second = {
            ...base,
            blockNumber: 2n,
            logIndex: 1,
            eventName: "VoucherUnlocked" as const,
            args: { campaignId: 9001n, user: wallet2 },
        };
        await applyCampaignEvent(db, first);
        await applyCampaignEvent(db, second);
        await applyCampaignEvent(db, first);
        await applyCampaignEvent(db, second);
        const [row] = await db.select().from(projectionCampaign);
        const vouchers = await db.select().from(consumerVoucher);
        expect(row.unlockedCount).toBe(2);
        expect(vouchers).toHaveLength(2);
    });

    it("does not change budget or counters when a batch is replayed", async () => {
        await seed();
        const batch = [
            {
                ...base,
                blockNumber: 2n,
                logIndex: 0,
                eventName: "CampaignFunded" as const,
                args: { campaignId: 9001n, amount: 100n },
            },
            {
                ...base,
                blockNumber: 2n,
                logIndex: 1,
                eventName: "VoucherUnlocked" as const,
                args: { campaignId: 9001n, user: wallet1 },
            },
            {
                ...base,
                blockNumber: 2n,
                logIndex: 2,
                eventName: "VoucherRedeemed" as const,
                args: { campaignId: 9001n, user: wallet1 },
            },
        ];
        for (const event of batch) await applyCampaignEvent(db, event);
        const [before] = await db.select().from(projectionCampaign);
        for (const event of batch) await applyCampaignEvent(db, event);
        const [after] = await db.select().from(projectionCampaign);
        expect(after).toMatchObject({
            budget: before.budget,
            unlockedCount: before.unlockedCount,
            redeemedCount: before.redeemedCount,
        });
        expect(after.budget).toBe(90n);
        expect(after.unlockedCount).toBe(1);
        expect(after.redeemedCount).toBe(1);
    });
});
