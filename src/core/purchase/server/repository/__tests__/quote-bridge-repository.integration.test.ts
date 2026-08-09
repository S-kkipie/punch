import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import {
    cafe,
    cafeMember,
    cafeProduct,
} from "@/server/drizzle/schemas/cafe-schema";
import { consumptionProof } from "@/server/drizzle/schemas/consumption-schema";
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import { bridgeQuoteToOrder } from "../quote-bridge-repository";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

type Fixture = {
    consumerUserId: string;
    operatorUserId: string;
    cafeId: string;
    productId: string;
    quoteId: string;
    extraUserIds?: string[];
};
const fixtures: Fixture[] = [];

async function createFixture(): Promise<Fixture> {
    const suffix = crypto.randomUUID();
    const fixture: Fixture = {
        consumerUserId: `consumer-${suffix}`,
        operatorUserId: `operator-${suffix}`,
        cafeId: `cafe-${suffix}`,
        productId: `product-${suffix}`,
        quoteId: `quote-${suffix}`,
    };
    const operatorWalletIndex = 100_000 + Math.floor(Math.random() * 900_000);
    const operatorWalletAddress = `0x${suffix.replaceAll("-", "").padStart(40, "0").slice(0, 40)}`;
    await db.insert(user).values([
        {
            id: fixture.consumerUserId,
            name: "Consumer",
            email: `${suffix}-consumer@integration.invalid`,
        },
        {
            id: fixture.operatorUserId,
            name: "Operator",
            email: `${suffix}-operator@integration.invalid`,
            walletIndex: operatorWalletIndex,
            walletAddress: operatorWalletAddress,
        },
    ]);
    await db.insert(cafe).values({
        id: fixture.cafeId,
        name: "Integration Café",
        slug: `integration-${suffix}`,
        chainCafeId: 700001,
        onboardingStatus: "approved",
    });
    await db.insert(cafeMember).values({
        cafeId: fixture.cafeId,
        userId: fixture.operatorUserId,
        role: "barista",
    });
    await db.insert(cafeProduct).values({
        id: fixture.productId,
        cafeId: fixture.cafeId,
        name: "Latte",
        priceSoles: "12",
        type: "emission",
        approvalStatus: "approved",
        active: true,
        chainProductId: 800001,
    });
    await db.insert(consumptionProof).values({
        id: fixture.quoteId,
        cafeId: fixture.cafeId,
        productId: fixture.productId,
        issuedByUserId: fixture.operatorUserId,
        consumerUserId: null,
        amountCentimos: 1200,
        purchaseOrderId: null,
        yapeRef: "YAPE-INTEGRATION-9988",
        receiptHash: null,
        nonce: null,
        cafeSignature: null,
        consumerSignature: null,
        failureReason: null,
        status: "issued",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    fixtures.push(fixture);
    return fixture;
}

async function cleanup() {
    for (const fixture of fixtures.splice(0)) {
        const orders = await db
            .select({ id: purchaseOrder.id })
            .from(purchaseOrder)
            .where(eq(purchaseOrder.cafeId, fixture.cafeId));
        if (orders.length > 0) {
            await db.delete(relayerJob).where(
                sql`${relayerJob.orderId} in (${sql.join(
                    orders.map((order) => sql`${order.id}`),
                    sql`, `,
                )})`,
            );
        }
        await db
            .delete(consumptionProof)
            .where(eq(consumptionProof.id, fixture.quoteId));
        await db
            .delete(purchaseOrder)
            .where(eq(purchaseOrder.cafeId, fixture.cafeId));
        await db
            .delete(cafeMember)
            .where(eq(cafeMember.cafeId, fixture.cafeId));
        await db
            .delete(cafeProduct)
            .where(eq(cafeProduct.id, fixture.productId));
        await db.delete(cafe).where(eq(cafe.id, fixture.cafeId));
        for (const extraUserId of fixture.extraUserIds ?? []) {
            await db.delete(user).where(eq(user.id, extraUserId));
        }
        await db.delete(user).where(eq(user.id, fixture.consumerUserId));
        await db.delete(user).where(eq(user.id, fixture.operatorUserId));
    }
}

async function dropRelayerFailureTrigger() {
    await db.execute(
        sql.raw(
            "DROP TRIGGER IF EXISTS punch_fail_relayer_job_insert_trigger ON relayer_job",
        ),
    );
    await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS punch_fail_relayer_job_insert()"),
    );
}

afterEach(async () => {
    if (!runIntegration) return;
    await dropRelayerFailureTrigger();
    await cleanup();
});

function bridgeInput(fixture: Fixture) {
    const orderId = `order-${fixture.quoteId}`;
    const proof = {
        cafeId: 700001n,
        user: "0x0000000000000000000000000000000000000021" as const,
        productId: 800001n,
        amount: 12_000_000n,
        receiptHash:
            "0x1111111111111111111111111111111111111111111111111111111111111111" as const,
        nonce: 987654321n,
        expiry: BigInt(Math.floor((Date.now() + 5 * 60 * 1000) / 1000)),
    };
    return {
        quoteId: fixture.quoteId,
        consumerUserId: fixture.consumerUserId,
        orderId,
        proof,
        cafeSignature:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
        userSignature:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
    };
}

async function countPurchaseOrdersForQuote(quoteId: string) {
    const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(consumptionProof)
        .innerJoin(
            purchaseOrder,
            eq(purchaseOrder.id, consumptionProof.purchaseOrderId),
        )
        .where(eq(consumptionProof.id, quoteId));
    return row?.count ?? 0;
}

async function countRelayerJobsForOrder(orderId: string) {
    const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(relayerJob)
        .where(eq(relayerJob.orderId, orderId));
    return row?.count ?? 0;
}

describeIntegration("quote bridge repository", () => {
    it("creates at most one purchase order and one relayer job across concurrent confirmations", async () => {
        const fixture = await createFixture();
        const input = bridgeInput(fixture);

        const results = await Promise.all([
            bridgeQuoteToOrder(input),
            bridgeQuoteToOrder({ ...input, orderId: `${input.orderId}-retry` }),
        ]);

        expect(new Set(results.map((result) => result.order.id)).size).toBe(1);
        expect(await countPurchaseOrdersForQuote(fixture.quoteId)).toBe(1);
        expect(await countRelayerJobsForOrder(results[0].order.id)).toBe(1);
    });

    it("rejects a second consumer without exposing the first consumer's order", async () => {
        const fixture = await createFixture();
        const first = bridgeInput(fixture);
        const secondConsumerId = `second-${fixture.consumerUserId}`;
        fixture.extraUserIds = [secondConsumerId];
        await db.insert(user).values({
            id: secondConsumerId,
            name: "Second Consumer",
            email: `${secondConsumerId}@integration.invalid`,
        });

        const [winner, loser] = await Promise.allSettled([
            bridgeQuoteToOrder(first),
            bridgeQuoteToOrder({
                ...first,
                consumerUserId: secondConsumerId,
                orderId: `${first.orderId}-other-consumer`,
            }),
        ]);

        expect([winner.status, loser.status].sort()).toEqual([
            "fulfilled",
            "rejected",
        ]);
        const fulfilled = [winner, loser].find(
            (
                result,
            ): result is PromiseFulfilledResult<
                Awaited<ReturnType<typeof bridgeQuoteToOrder>>
            > => result.status === "fulfilled",
        );
        const rejected = [winner, loser].find(
            (result): result is PromiseRejectedResult =>
                result.status === "rejected",
        );
        expect(fulfilled).toBeDefined();
        expect(rejected).toBeDefined();
        if (fulfilled && rejected) {
            expect(String(rejected.reason)).not.toContain(
                fulfilled.value.order.id,
            );
        }
    });

    it("rejects a quote that expires while the bridge transaction waits on the row lock", async () => {
        const fixture = await createFixture();
        const expiresAt = new Date(Date.now() + 120);
        await db
            .update(consumptionProof)
            .set({ expiresAt })
            .where(eq(consumptionProof.id, fixture.quoteId));

        const lockClient = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: false,
        });
        await lockClient.connect();
        await lockClient.query("begin");
        await lockClient.query(
            "select id from consumption_proof where id = $1 for update",
            [fixture.quoteId],
        );

        const pending = bridgeQuoteToOrder(bridgeInput(fixture));
        const rejection = expect(pending).rejects.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 180));
        await lockClient.query("commit");
        await lockClient.end();

        await rejection;
        expect(await countPurchaseOrdersForQuote(fixture.quoteId)).toBe(0);
    });

    it("rolls back the quote bridge when relayer job creation fails", async () => {
        const fixture = await createFixture();
        const input = bridgeInput(fixture);
        await db.execute(
            sql.raw(
                "CREATE OR REPLACE FUNCTION punch_fail_relayer_job_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql",
            ),
        );
        await db.execute(
            sql.raw(
                "CREATE TRIGGER punch_fail_relayer_job_insert_trigger BEFORE INSERT ON relayer_job FOR EACH ROW EXECUTE FUNCTION punch_fail_relayer_job_insert()",
            ),
        );

        await expect(bridgeQuoteToOrder(input)).rejects.toThrow();

        const [quoteRow] = await db
            .select()
            .from(consumptionProof)
            .where(eq(consumptionProof.id, fixture.quoteId));
        expect(quoteRow.status).toBe("issued");
        expect(quoteRow.purchaseOrderId).toBeNull();
        expect(await countPurchaseOrdersForQuote(fixture.quoteId)).toBe(0);
        expect(await countRelayerJobsForOrder(input.orderId)).toBe(0);
    });

    it("never leaves a submitted or confirmed quote without a linked order", async () => {
        const fixture = await createFixture();

        await expect(
            db
                .update(consumptionProof)
                .set({
                    status: "submitted",
                    consumerUserId: fixture.consumerUserId,
                    purchaseOrderId: null,
                })
                .where(eq(consumptionProof.id, fixture.quoteId)),
        ).rejects.toThrow();

        const [quoteRow] = await db
            .select()
            .from(consumptionProof)
            .where(eq(consumptionProof.id, fixture.quoteId));
        expect(quoteRow.status).toBe("issued");
        expect(quoteRow.purchaseOrderId).toBeNull();
    });
});
