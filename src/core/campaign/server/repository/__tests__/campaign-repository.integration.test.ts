import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";
import { campaign } from "@/server/drizzle/schemas/punch-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import {
    findCampaignWithProjection,
    listCafeCampaigns,
} from "../campaign-repository";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

const fixtures: {
    cafeId: string;
    campaignIds: string[];
    chainIds: number[];
}[] = [];

async function createFixture() {
    const suffix = crypto.randomUUID();
    const cafeId = `integration-cafe-${suffix}`;
    const campaignIds = [
        `integration-campaign-a-${suffix}`,
        `integration-campaign-b-${suffix}`,
    ];
    const chainIds = [900000 + Math.floor(Math.random() * 9000)];
    await db.insert(cafe).values({
        id: cafeId,
        name: "Integration Café",
        slug: `integration-${suffix}`,
    });
    await db.insert(campaign).values([
        {
            id: campaignIds[0],
            cafeId,
            kind: "verified_acquisition",
            name: "Awaiting chain",
            windowStart: new Date("2026-09-01T00:00:00Z"),
            windowEnd: new Date("2026-09-30T00:00:00Z"),
        },
        {
            id: campaignIds[1],
            cafeId,
            kind: "verified_acquisition",
            name: "Confirmed chain",
            windowStart: new Date("2026-09-01T00:00:00Z"),
            windowEnd: new Date("2026-09-30T00:00:00Z"),
            chainCampaignId: chainIds[0],
            voucherPayout: 5_000_000n,
            maxVouchers: 20,
        },
    ]);
    await db.insert(projectionCampaign).values({
        chainCampaignId: chainIds[0],
        status: "draft",
        budget: 100_000_000n,
        voucherPayout: 5_000_000n,
        maxVouchers: 20,
        expiry: new Date("2026-09-30T00:00:00Z"),
        lastBlock: 1n,
    });
    const fixture = { cafeId, campaignIds, chainIds };
    fixtures.push(fixture);
    return fixture;
}

async function cleanup() {
    for (const fixture of fixtures.splice(0)) {
        await db
            .delete(projectionCampaign)
            .where(
                inArray(projectionCampaign.chainCampaignId, fixture.chainIds),
            );
        await db
            .delete(campaign)
            .where(inArray(campaign.id, fixture.campaignIds));
        await db.delete(cafe).where(eq(cafe.id, fixture.cafeId));
    }
}

afterEach(async () => {
    if (runIntegration) await cleanup();
});

describeIntegration("campaign repository", () => {
    it("lists campaigns with a null projection while chain confirmation is pending", async () => {
        const fixture = await createFixture();
        const rows = await listCafeCampaigns(fixture.cafeId);

        expect(rows).toHaveLength(2);
        expect(
            rows.find(({ campaign: row }) => row.id === fixture.campaignIds[0]),
        ).toMatchObject({
            projection: null,
        });
        expect(
            rows.find(({ campaign: row }) => row.id === fixture.campaignIds[1]),
        ).toMatchObject({
            projection: {
                chainCampaignId: fixture.chainIds[0],
                status: "draft",
            },
        });
    });

    it("returns the campaign and its projection by id", async () => {
        const fixture = await createFixture();
        await expect(
            findCampaignWithProjection(fixture.campaignIds[0]),
        ).resolves.toMatchObject({
            campaign: { id: fixture.campaignIds[0] },
            projection: null,
        });
    });
});
