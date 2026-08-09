import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import {
    claimSubmittedJobs,
    findJobsToRun,
    markJobConfirmed,
    markJobPending,
    markJobSubmitted,
    updateOrderAndQueue,
} from "../purchase-repository";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

type Fixture = {
    userId: string;
    cafeId: string;
    productId: string;
    orderId: string;
    jobId?: string;
};
const fixtures: Fixture[] = [];

async function createFixture(
    expiry = new Date(Date.now() + 60_000),
): Promise<Fixture> {
    const suffix = crypto.randomUUID();
    const fixture = {
        userId: `integration-user-${suffix}`,
        cafeId: `integration-cafe-${suffix}`,
        productId: `integration-product-${suffix}`,
        orderId: `integration-order-${suffix}`,
    };
    await db.insert(user).values({
        id: fixture.userId,
        name: "Integration User",
        email: `${suffix}@integration.invalid`,
    });
    await db.insert(cafe).values({
        id: fixture.cafeId,
        name: "Integration Café",
        slug: `integration-${suffix}`,
        chainCafeId: 900000 + Math.floor(Math.random() * 9000),
        onboardingStatus: "approved",
    });
    await db.insert(cafeProduct).values({
        id: fixture.productId,
        cafeId: fixture.cafeId,
        name: "Integration Product",
        priceSoles: "8",
        type: "emission",
        approvalStatus: "approved",
        active: true,
        chainProductId: 900000 + Math.floor(Math.random() * 9000),
    });
    await db.insert(purchaseOrder).values({
        id: fixture.orderId,
        cafeId: fixture.cafeId,
        userId: fixture.userId,
        productId: fixture.productId,
        amount: 8_000_000n,
        yapeRef: `integration-${suffix}`,
        receiptHash: `0x${suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64)}`,
        nonce: "1",
        expiry,
        status: "user_confirmed",
    });
    fixtures.push(fixture);
    return fixture;
}

async function cleanup() {
    for (const fixture of fixtures.splice(0)) {
        await db
            .delete(relayerJob)
            .where(eq(relayerJob.orderId, fixture.orderId));
        await db
            .delete(purchaseOrder)
            .where(eq(purchaseOrder.id, fixture.orderId));
        await db
            .delete(cafeProduct)
            .where(eq(cafeProduct.id, fixture.productId));
        await db.delete(cafe).where(eq(cafe.id, fixture.cafeId));
        await db.delete(user).where(eq(user.id, fixture.userId));
    }
}

afterEach(async () => {
    if (runIntegration) await cleanup();
});

describeIntegration("purchase repository concurrency", () => {
    it("does not queue an expired order or create a relayer job", async () => {
        const fixture = await createFixture(new Date(Date.now() - 1_000));
        const result = await updateOrderAndQueue(fixture.orderId, {
            proof: {},
        });

        expect(result.outcome).toBe("current");
        expect(result.order.status).toBe("user_confirmed");
        const jobs = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.orderId, fixture.orderId));
        expect(jobs).toHaveLength(0);
    });

    it("claims a due job once, then claims it after its lease expires", async () => {
        const fixture = await createFixture();
        const [job] = await db
            .insert(relayerJob)
            .values({
                orderId: fixture.orderId,
                kind: "consumption_record",
                idempotencyKey: `consumption:${fixture.orderId}`,
                payload: {},
            })
            .returning();
        fixture.jobId = job.id;

        const leaseMs = 200;
        const [first, second] = await Promise.all([
            findJobsToRun(1, leaseMs),
            findJobsToRun(1, leaseMs),
        ]);
        expect([first.length, second.length].sort()).toEqual([0, 1]);
        expect([...first, ...second].map((claimed) => claimed.id)).toEqual([
            job.id,
        ]);

        await new Promise((resolve) => setTimeout(resolve, leaseMs + 10));
        const afterLease = await findJobsToRun(1, leaseMs);
        expect(afterLease.map((claimed) => claimed.id)).toEqual([job.id]);
    });

    it("updates job and order atomically for submitted and confirmed transitions", async () => {
        const fixture = await createFixture();
        await updateOrderAndQueue(fixture.orderId, { proof: {} });
        const [job] = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.orderId, fixture.orderId));

        await markJobSubmitted(
            job.id,
            `0x${"77".repeat(32)}`,
            new Date(Date.now() + 60_000),
        );
        const [submittedJob] = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.id, job.id));
        const [submittedOrder] = await db
            .select()
            .from(purchaseOrder)
            .where(eq(purchaseOrder.id, fixture.orderId));
        expect(submittedJob.status).toBe("submitted");
        expect(submittedOrder.status).toBe("submitted");
        expect(submittedOrder.txHash).toBe(`0x${"77".repeat(32)}`);

        await markJobConfirmed(job.id);
        const [confirmedJob] = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.id, job.id));
        const [confirmedOrder] = await db
            .select()
            .from(purchaseOrder)
            .where(eq(purchaseOrder.id, fixture.orderId));
        expect(confirmedJob.status).toBe("confirmed");
        expect(confirmedOrder.status).toBe("confirmed");

        await expect(markJobConfirmed(job.id)).resolves.toBeNull();

        await markJobPending(job.id, new Date(Date.now() + 1_000));
        const [unchangedJob] = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.id, job.id));
        const [unchangedOrder] = await db
            .select()
            .from(purchaseOrder)
            .where(eq(purchaseOrder.id, fixture.orderId));
        expect(unchangedJob.status).toBe("confirmed");
        expect(unchangedOrder.status).toBe("confirmed");
    });

    it("accepts indexer-first order confirmation before the relayer confirms the submitted job", async () => {
        const fixture = await createFixture();
        await updateOrderAndQueue(fixture.orderId, { proof: {} });
        const [job] = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.orderId, fixture.orderId));

        await markJobSubmitted(
            job.id,
            `0x${"66".repeat(32)}`,
            new Date(Date.now() + 60_000),
        );
        await db
            .update(purchaseOrder)
            .set({ status: "confirmed" })
            .where(eq(purchaseOrder.id, fixture.orderId));

        await expect(markJobConfirmed(job.id)).resolves.toMatchObject({
            orderId: fixture.orderId,
        });

        const [confirmedJob] = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.id, job.id));
        const [confirmedOrder] = await db
            .select()
            .from(purchaseOrder)
            .where(eq(purchaseOrder.id, fixture.orderId));
        expect(confirmedJob.status).toBe("confirmed");
        expect(confirmedOrder.status).toBe("confirmed");
    });

    it("claims submitted jobs once across recovery workers", async () => {
        const fixture = await createFixture();
        await updateOrderAndQueue(fixture.orderId, { proof: {} });
        const [job] = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.orderId, fixture.orderId));
        await markJobSubmitted(
            job.id,
            `0x${"88".repeat(32)}`,
            new Date(Date.now() - 1_000),
        );

        const leaseMs = 200;
        const [first, second] = await Promise.all([
            claimSubmittedJobs(1, leaseMs),
            claimSubmittedJobs(1, leaseMs),
        ]);
        expect([first.length, second.length].sort()).toEqual([0, 1]);
        expect([...first, ...second].map((claimed) => claimed.id)).toEqual([
            job.id,
        ]);

        await new Promise((resolve) => setTimeout(resolve, leaseMs + 10));
        const afterLease = await claimSubmittedJobs(1, leaseMs);
        expect(afterLease.map((claimed) => claimed.id)).toEqual([job.id]);
    });
});
