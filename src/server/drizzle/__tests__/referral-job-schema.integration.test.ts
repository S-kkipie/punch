import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";

const integration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!integration);

describeIntegration("referral_record relayer job schema", () => {
    installIntegrationDbMutex();
    const created: string[] = [];

    afterEach(async () => {
        for (const id of created.splice(0)) {
            await db.delete(relayerJob).where(eq(relayerJob.id, id));
        }
    });

    it("accepts a referral_record job with no order and no redemption request", async () => {
        const [row] = await db
            .insert(relayerJob)
            .values({
                kind: "referral_record",
                idempotencyKey: `referral:test:${crypto.randomUUID()}`,
                payload: {
                    epoch: 202608,
                    originCafeId: 1,
                    referralId: "0xabc",
                },
            })
            .returning({ id: relayerJob.id, kind: relayerJob.kind });
        created.push(row.id);
        expect(row.kind).toBe("referral_record");
    });
});
