import { describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";

const run = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeDb = describe.skipIf(!run);

describeDb("relayer_job generalization", () => {
    it("accepts a job with no purchase order", async () => {
        const key = `campaign_create:${crypto.randomUUID()}`;
        const [row] = await db
            .insert(relayerJob)
            .values({
                kind: "campaign_create",
                idempotencyKey: key,
                payload: { campaignId: "c1" },
            })
            .returning();

        expect(row.orderId).toBeNull();
        expect(row.kind).toBe("campaign_create");
    });

    it("rejects a duplicate idempotency key", async () => {
        const key = `campaign_create:${crypto.randomUUID()}`;
        await db.insert(relayerJob).values({
            kind: "campaign_create",
            idempotencyKey: key,
            payload: {},
        });

        await expect(
            db.insert(relayerJob).values({
                kind: "campaign_create",
                idempotencyKey: key,
                payload: {},
            }),
        ).rejects.toThrow();
    });
});
