import { eq, like } from "drizzle-orm";
import { keccak256, toBytes } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import {
    enqueueReferralRecord,
    referralKeyForCrawl,
    referralKeyForVoucher,
} from "../referrals";

const integration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!integration);

describeIntegration("enqueueReferralRecord", () => {
    installIntegrationDbMutex();
    const suffix = crypto.randomUUID();

    afterEach(async () => {
        await db
            .delete(relayerJob)
            .where(like(relayerJob.idempotencyKey, `referral:%${suffix}%`));
    });

    it("enqueues exactly one job per referral key", async () => {
        const key = referralKeyForVoucher(7, `0xAbC${suffix}`);
        await db.transaction(async (tx) => {
            await enqueueReferralRecord(tx, {
                originChainCafeId: 3,
                referralKey: key,
                epoch: 202608,
            });
            await enqueueReferralRecord(tx, {
                originChainCafeId: 3,
                referralKey: key,
                epoch: 202608,
            });
        });
        const rows = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.idempotencyKey, `referral:${key}`));
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe("referral_record");
        expect(rows[0].payload).toMatchObject({
            epoch: 202608,
            originCafeId: 3,
            referralId: keccak256(toBytes(key)),
        });
    });

    it("normalizes voucher keys to lowercase addresses and builds crawl keys", () => {
        expect(referralKeyForVoucher(7, "0xABcD")).toBe("voucher:7:0xabcd");
        expect(referralKeyForCrawl(`u-${suffix}`, 1, 2)).toBe(
            `crawl:u-${suffix}:1:2`,
        );
    });
});
