import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";
import {
    campaign,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";
import { applyCampaignEvent } from "../campaign-projection";

const describeIntegration = describe.skipIf(
    process.env.PUNCH_RUN_INTEGRATION !== "1",
);
const suffix = crypto.randomUUID();
const ids = {
    cafe: `campaign-referral-cafe-${suffix}`,
    campaign: `campaign-referral-campaign-${suffix}`,
    user: `campaign-referral-user-${suffix}`,
};
const chainCampaignId = 1_730_001;
const chainCafeId = 1_730_002;
const walletAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const idempotencyKey = `referral:voucher:${chainCampaignId}:${walletAddress}`;
const event = {
    transactionHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    transactionIndex: 0,
    blockNumber: 2n,
    logIndex: 0,
    eventName: "VoucherUnlocked" as const,
    args: { campaignId: BigInt(chainCampaignId), user: walletAddress },
};

async function seed() {
    await db.insert(user).values({
        id: ids.user,
        name: "Campaign Referral User",
        email: `${suffix}@campaign-referral.invalid`,
        walletAddress,
    });
    await db.insert(cafe).values({
        id: ids.cafe,
        name: "Campaign Referral Cafe",
        slug: `campaign-referral-${suffix}`,
        chainCafeId,
        onboardingStatus: "approved",
    });
    await db.insert(campaign).values({
        id: ids.campaign,
        kind: "verified_acquisition",
        cafeId: ids.cafe,
        name: "Campaign Referral",
        windowStart: new Date(0),
        windowEnd: new Date("2030-01-01"),
        chainCampaignId,
    });
    await db.insert(projectionCampaign).values({
        chainCampaignId,
        status: "published",
        budget: 100n,
        voucherPayout: 1n,
        maxVouchers: 10,
        expiry: new Date("2030-01-01"),
        unlockedCount: 0,
        redeemedCount: 0,
        lastBlock: 1n,
    });
}

async function cleanup() {
    await db
        .delete(relayerJob)
        .where(eq(relayerJob.idempotencyKey, idempotencyKey));
    await db
        .delete(consumerVoucher)
        .where(eq(consumerVoucher.consumerUserId, ids.user));
    await db
        .delete(projectionCampaign)
        .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));
    await db.delete(campaign).where(eq(campaign.id, ids.campaign));
    await db.delete(cafe).where(eq(cafe.id, ids.cafe));
    await db.delete(user).where(eq(user.id, ids.user));
}

describeIntegration("campaign referral enqueueing", () => {
    afterEach(cleanup);

    it("enqueues a verified referral after a voucher unlock, once on replay", async () => {
        await seed();
        await applyCampaignEvent(db, event);
        await applyCampaignEvent(db, event);

        const jobs = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.idempotencyKey, idempotencyKey));
        expect(jobs).toHaveLength(1);
        expect(jobs[0].payload).toMatchObject({ originCafeId: chainCafeId });
    });
});
