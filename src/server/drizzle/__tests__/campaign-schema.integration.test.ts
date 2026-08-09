import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";

const run = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeDb = describe.skipIf(!run);

const chainCampaignId = 1;

describeDb("campaign projection schema", () => {
    afterEach(async () => {
        await db
            .delete(projectionCampaign)
            .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));
    });

    it("stores escrow state keyed by chain campaign id", async () => {
        await db.insert(projectionCampaign).values({
            chainCampaignId,
            status: "draft",
            budget: 0n,
            voucherPayout: 0n,
            maxVouchers: 0,
            expiry: new Date(0),
            unlockedCount: 0,
            redeemedCount: 0,
            lastBlock: 1n,
        });

        const [row] = await db
            .select()
            .from(projectionCampaign)
            .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));

        expect(row.status).toBe("draft");
        expect(row.budget).toBe(0n);
    });
});
