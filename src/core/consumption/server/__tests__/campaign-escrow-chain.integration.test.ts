import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { redemptionRequest } from "@/server/drizzle/schemas/consumption-schema";
import {
    campaign,
    coffeeCrawl,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import { CampaignEscrowChain } from "../campaign-escrow-chain";
import { ConsumerChainError } from "../chain-port";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

type Fixture = {
    userIds: string[];
    cafeId: string;
    campaignIds: string[];
    crawlId: string;
    voucherIds: string[];
    requestIds: string[];
    jobKeys: string[];
};
const fixtures: Fixture[] = [];

async function seedFixture(): Promise<Fixture> {
    const suffix = crypto.randomUUID();
    const f: Fixture = {
        userIds: [`escrow-user-${suffix}`, `escrow-walletless-${suffix}`],
        cafeId: `escrow-cafe-${suffix}`,
        campaignIds: [`escrow-campaign-${suffix}`, `escrow-unlinked-${suffix}`],
        crawlId: `escrow-crawl-${suffix}`,
        voucherIds: [],
        requestIds: [],
        jobKeys: [],
    };
    fixtures.push(f);
    await db.insert(user).values([
        {
            id: f.userIds[0],
            name: "Escrow Integration User",
            email: `${f.userIds[0]}@invalid.test`,
            walletAddress: "0xAbCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
        },
        {
            id: f.userIds[1],
            name: "Escrow Walletless User",
            email: `${f.userIds[1]}@invalid.test`,
        },
    ]);
    await db.insert(cafe).values({
        id: f.cafeId,
        name: "Escrow Integration Café",
        slug: f.cafeId,
        chainCafeId: 990000 + Math.floor(Math.random() * 9999),
        onboardingStatus: "approved",
    });
    await db.insert(campaign).values([
        {
            id: f.campaignIds[0],
            kind: "verified_acquisition",
            cafeId: f.cafeId,
            name: "Escrow Campaign",
            windowStart: new Date(Date.now() - 60_000),
            windowEnd: new Date(Date.now() + 60_000),
            chainCampaignId: 980000 + Math.floor(Math.random() * 9999),
        },
        {
            id: f.campaignIds[1],
            kind: "verified_acquisition",
            cafeId: f.cafeId,
            name: "Unlinked Campaign",
            windowStart: new Date(Date.now() - 60_000),
            windowEnd: new Date(Date.now() + 60_000),
            chainCampaignId: null,
        },
    ]);
    await db.insert(coffeeCrawl).values({
        id: f.crawlId,
        name: "Escrow Crawl",
        expiresAt: new Date(Date.now() + 60_000),
    });
    return f;
}

async function voucher(
    f: Fixture,
    input: {
        source?: "campaign" | "crawl";
        campaignId?: string | null;
        status?: "available" | "redeemed" | "expired";
        consumerUserId?: string;
    } = {},
) {
    const id = `escrow-voucher-${f.voucherIds.length}-${f.userIds[0]}`;
    await db.insert(consumerVoucher).values({
        id,
        source: input.source ?? "campaign",
        campaignId:
            input.source === "crawl"
                ? null
                : input.campaignId === undefined
                  ? f.campaignIds[0]
                  : input.campaignId,
        crawlId: input.source === "crawl" ? f.crawlId : null,
        consumerUserId: input.consumerUserId ?? f.userIds[0],
        status: input.status ?? "available",
        expiresAt: new Date(Date.now() + 60_000),
    });
    f.voucherIds.push(id);
    return id;
}

async function request(
    f: Fixture,
    voucherId: string,
    status: "pending" | "approved" = "approved",
    consumerUserId = f.userIds[0],
) {
    const id = `escrow-request-${f.requestIds.length}-${f.userIds[0]}`;
    await db.insert(redemptionRequest).values({
        id,
        kind: "voucher",
        consumerUserId,
        cafeId: f.cafeId,
        voucherId,
        status,
    });
    f.requestIds.push(id);
    return id;
}

async function jobsFor(f: Fixture) {
    return db
        .select()
        .from(relayerJob)
        .where(inArray(relayerJob.idempotencyKey, f.jobKeys));
}

afterEach(async () => {
    for (const f of fixtures.splice(0)) {
        await db
            .delete(relayerJob)
            .where(inArray(relayerJob.idempotencyKey, f.jobKeys));
        await db
            .delete(redemptionRequest)
            .where(inArray(redemptionRequest.id, f.requestIds));
        await db
            .delete(consumerVoucher)
            .where(inArray(consumerVoucher.id, f.voucherIds));
        await db.delete(campaign).where(inArray(campaign.id, f.campaignIds));
        await db.delete(coffeeCrawl).where(eq(coffeeCrawl.id, f.crawlId));
        await db.delete(cafe).where(eq(cafe.id, f.cafeId));
        await db.delete(user).where(inArray(user.id, f.userIds));
    }
});

describeIntegration("CampaignEscrowChain", () => {
    it("enqueues one exact job, preserves voucher state, and reuses it", async () => {
        const f = await seedFixture();
        const voucherId = await voucher(f);
        const requestId = await request(f, voucherId);
        const key = `voucher_redeem:${requestId}`;
        f.jobKeys.push(key);
        const chain = new CampaignEscrowChain();

        const [first, concurrent] = await Promise.all([
            chain.submitVoucherRedemption({
                redemptionRequestId: requestId,
                idempotencyKey: `voucher_redemption:${requestId}`,
            }),
            chain.submitVoucherRedemption({
                redemptionRequestId: requestId,
                idempotencyKey: "ignored-concurrent",
            }),
        ]);
        expect(concurrent).toEqual(first);
        const rows = await jobsFor(f);
        expect(rows).toHaveLength(1);
        expect(first).toEqual({ transactionId: rows[0].id, status: "pending" });
        expect(rows[0].idempotencyKey).toBe(key);
        expect(rows[0].payload).toEqual({
            chainCampaignId: expect.any(Number),
            userAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            redemptionRequestId: requestId,
            voucherId,
            campaignId: f.campaignIds[0],
        });
        await expect(
            db
                .select({ status: consumerVoucher.status })
                .from(consumerVoucher)
                .where(eq(consumerVoucher.id, voucherId)),
        ).resolves.toEqual([{ status: "available" }]);

        const second = await chain.submitVoucherRedemption({
            redemptionRequestId: requestId,
            idempotencyKey: "ignored",
        });
        expect(second).toEqual(first);
        expect(await jobsFor(f)).toHaveLength(1);
    });

    it.each([
        ["missing request", async (_f: Fixture) => "missing"],
        [
            "unapproved request",
            async (f: Fixture) => request(f, await voucher(f), "pending"),
        ],
        [
            "crawl voucher",
            async (f: Fixture) =>
                request(f, await voucher(f, { source: "crawl" })),
        ],
        [
            "unavailable voucher",
            async (f: Fixture) =>
                request(f, await voucher(f, { status: "redeemed" })),
        ],
        [
            "unlinked campaign",
            async (f: Fixture) =>
                request(f, await voucher(f, { campaignId: f.campaignIds[1] })),
        ],
        [
            "missing wallet",
            async (f: Fixture) =>
                request(
                    f,
                    await voucher(f, { consumerUserId: f.userIds[1] }),
                    "approved",
                    f.userIds[1],
                ),
        ],
    ])("rejects %s without enqueue", async (_name, makeRequest) => {
        const f = await seedFixture();
        const requestId = await makeRequest(f);
        const key = `voucher_redeem:${requestId}`;
        f.jobKeys.push(key);
        await expect(
            new CampaignEscrowChain().submitVoucherRedemption({
                redemptionRequestId: requestId,
                idempotencyKey: "ignored",
            }),
        ).rejects.toBeInstanceOf(ConsumerChainError);
        expect(await jobsFor(f)).toHaveLength(0);
    });

    it("rejects a request whose campaign link is null", async () => {
        const f = await seedFixture();
        const requestId = await request(
            f,
            await voucher(f, { campaignId: f.campaignIds[1] }),
        );
        f.jobKeys.push(`voucher_redeem:${requestId}`);
        await expect(
            new CampaignEscrowChain().submitVoucherRedemption({
                redemptionRequestId: requestId,
                idempotencyKey: "ignored",
            }),
        ).rejects.toMatchObject({ code: "REQUEST_NOT_APPROVED" });
        expect(await jobsFor(f)).toHaveLength(0);
    });
});
