import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
    enqueueJob,
    findJobsToRun,
    markJobConfirmed,
} from "@/core/chain/server/relayer/job-repository";
import { db } from "@/server/drizzle/db";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";

const run = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeDb = describe.skipIf(!run);

describeDb("job repository", () => {
    it("enqueues once per idempotency key", async () => {
        const key = `campaign_create:${crypto.randomUUID()}`;
        const first = await enqueueJob(db, {
            kind: "campaign_create",
            idempotencyKey: key,
            payload: { campaignId: "c1" },
        });
        const second = await enqueueJob(db, {
            kind: "campaign_create",
            idempotencyKey: key,
            payload: { campaignId: "c1" },
        });

        expect(first).not.toBeNull();
        expect(second).toBeNull();
    });

    it("runs the side effect inside the confirm transaction", async () => {
        const key = `campaign_publish:${crypto.randomUUID()}`;
        const job = await enqueueJob(db, {
            kind: "campaign_publish",
            idempotencyKey: key,
            payload: {},
        });
        if (!job) throw new Error("enqueue failed");

        let sawJobId = "";
        await markJobConfirmed(job.id, async (_tx, confirmed) => {
            sawJobId = confirmed.id;
        });

        const [row] = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.id, job.id));
        expect(row.status).toBe("confirmed");
        expect(sawJobId).toBe(job.id);
    });

    it("claims pending jobs of any kind", async () => {
        await enqueueJob(db, {
            kind: "voucher_unlock",
            idempotencyKey: `voucher_unlock:${crypto.randomUUID()}`,
            payload: {},
        });
        const claimed = await findJobsToRun(10);
        expect(claimed.some((j) => j.kind === "voucher_unlock")).toBe(true);
    });
});
