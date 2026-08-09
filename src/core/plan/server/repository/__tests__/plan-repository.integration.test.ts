import { eq, isNotNull } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { planOrder } from "@/server/drizzle/schemas/plan-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import {
    findInFlightByCafe,
    findOrdersToRun,
    insertOrderIfIdle,
    markOrderConfirmed,
    markOrderFailed,
} from "../plan-repository";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

const created: string[] = [];

async function fixture() {
    const [seedUser] = await db.select({ id: user.id }).from(user).limit(1);
    const [seedCafe] = await db
        .select({ id: cafe.id, chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .where(isNotNull(cafe.chainCafeId))
        .limit(1);
    if (!seedUser || !seedCafe || seedCafe.chainCafeId === null) {
        throw new Error(
            "plan repository test needs a seeded cafe with a chain id",
        );
    }
    return {
        userId: seedUser.id,
        cafeId: seedCafe.id,
        chainCafeId: seedCafe.chainCafeId,
    };
}

function newOrder(base: {
    userId: string;
    cafeId: string;
    chainCafeId: number;
}) {
    const id = crypto.randomUUID();
    created.push(id);
    return {
        id,
        cafeId: base.cafeId,
        chainCafeId: base.chainCafeId,
        userId: base.userId,
        kind: "plan" as const,
        price: 49_000_000n,
        signerAddress: "0x1111111111111111111111111111111111111111",
        signerWalletIndex: 7,
    };
}

describeIntegration("plan repository", () => {
    afterEach(async () => {
        for (const id of created.splice(0)) {
            await db.delete(planOrder).where(eq(planOrder.id, id));
        }
    });

    it("inserts an order when the cafe has none in flight", async () => {
        const base = await fixture();
        const result = await insertOrderIfIdle(newOrder(base));
        expect(result.created).toBe(true);
        expect(result.row.status).toBe("pending");
        expect(result.row.price).toBe(49_000_000n);
    });

    it("returns the existing order instead of charging twice", async () => {
        const base = await fixture();
        const first = await insertOrderIfIdle(newOrder(base));
        const second = await insertOrderIfIdle(newOrder(base));
        expect(second.created).toBe(false);
        expect(second.row.id).toBe(first.row.id);
        const inFlight = await findInFlightByCafe(base.cafeId);
        expect(inFlight?.id).toBe(first.row.id);
    });

    it("lets a new order in once the previous one is terminal", async () => {
        const base = await fixture();
        const first = await insertOrderIfIdle(newOrder(base));
        await markOrderConfirmed(first.row.id);
        const second = await insertOrderIfIdle(newOrder(base));
        expect(second.created).toBe(true);
        expect(second.row.id).not.toBe(first.row.id);
        expect(await findInFlightByCafe(base.cafeId)).not.toBeNull();
    });

    it("claims pending orders once and leases them", async () => {
        const base = await fixture();
        const order = await insertOrderIfIdle(newOrder(base));
        const firstClaim = await findOrdersToRun(10);
        expect(firstClaim.map((row) => row.id)).toContain(order.row.id);
        const secondClaim = await findOrdersToRun(10);
        expect(secondClaim.map((row) => row.id)).not.toContain(order.row.id);
    });

    it("records a permanent failure with its reason", async () => {
        const base = await fixture();
        const order = await insertOrderIfIdle(newOrder(base));
        const failed = await markOrderFailed(
            order.row.id,
            "NotAuthorizedForCafe(1, 0x0)",
            "not_authorized",
        );
        expect(failed?.status).toBe("failed");
        expect(failed?.failureReason).toBe("not_authorized");
    });
});
