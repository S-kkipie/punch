import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
    DEMO_CAMPAIGN_NAME,
    demoCampaignValues,
} from "@/core/punch/domain/demo-state";
import { db } from "@/server/drizzle/db";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { campaign } from "@/server/drizzle/schemas/punch-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import { bootstrapRepository } from "../repository";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

const fixtures: { cafeId: string }[] = [];

async function createFixture() {
    const suffix = crypto.randomUUID();
    const fixture = { cafeId: `integration-bootstrap-cafe-${suffix}` };
    await db.insert(cafe).values({
        id: fixture.cafeId,
        name: "Integration Bootstrap Café",
        slug: `integration-bootstrap-${suffix}`,
    });
    fixtures.push(fixture);
    return fixture;
}

async function cleanup() {
    for (const fixture of fixtures.splice(0)) {
        await db.delete(campaign).where(eq(campaign.cafeId, fixture.cafeId));
        await db.delete(cafe).where(eq(cafe.id, fixture.cafeId));
    }
}

afterEach(async () => {
    if (runIntegration) await cleanup();
});

describeIntegration("bootstrap campaign repository", () => {
    it("returns one canonical campaign for concurrent inserts at one café", async () => {
        const fixture = await createFixture();
        const values = demoCampaignValues(Date.now(), fixture.cafeId);

        const campaigns = await Promise.all(
            Array.from({ length: 2 }, () =>
                bootstrapRepository.insertDemoCampaign({
                    cafeId: fixture.cafeId,
                    values,
                    voucherPayout: values.voucherPayout,
                    maxVouchers: values.maxVouchers,
                }),
            ),
        );

        expect(campaigns[0]?.id).toBe(campaigns[1]?.id);
        const rows = await db
            .select({ id: campaign.id })
            .from(campaign)
            .where(
                and(
                    eq(campaign.cafeId, fixture.cafeId),
                    eq(campaign.name, DEMO_CAMPAIGN_NAME),
                    eq(campaign.kind, "verified_acquisition"),
                ),
            );
        expect(rows).toHaveLength(1);
    });
});
