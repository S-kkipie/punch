import { eq } from "drizzle-orm";
import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { describe, expect, it } from "vitest";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import { PLAN_SPLITS } from "@/core/plan/domain/schemas";
import { runPlanRunnerOnce } from "@/core/plan/server/runner/plan-runner";
import { createPlanOrderService } from "@/core/plan/server/services/create-plan-order-service";
import { getPlanStatusService } from "@/core/plan/server/services/get-plan-status-service";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCafeCredit } from "@/server/drizzle/schemas/chain-schema";
import { planOrder } from "@/server/drizzle/schemas/plan-schema";

const live =
    process.env.PUNCH_RUN_INTEGRATION === "1" &&
    process.env.PUNCH_RUN_LIVE_CHAIN === "1";
const describeLive = describe.skipIf(!live);

const pub = createPublicClient({
    chain: foundry,
    transport: http(process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545"),
});

async function readBalances() {
    const addresses = getAddresses();
    const read = (account: `0x${string}`) =>
        pub.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [account],
        }) as Promise<bigint>;
    return {
        vault: await read(addresses.punchVault),
        fund: await read(addresses.networkFund),
    };
}

async function drainRunner(orderId: string, times = 8) {
    for (let i = 0; i < times; i += 1) {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 2_100));
        await runPlanRunnerOnce();
        await runIndexerOnce();

        const [order] = await db
            .select({ status: planOrder.status })
            .from(planOrder)
            .where(eq(planOrder.id, orderId));
        if (order?.status === "confirmed") return;
    }

    const [order] = await db
        .select({ status: planOrder.status })
        .from(planOrder)
        .where(eq(planOrder.id, orderId));
    expect(
        order?.status,
        `plan order ${orderId} did not confirm after ${times} runner ticks`,
    ).toBe("confirmed");
}

async function findCafeOwner(slug: string, email: string) {
    const [owner] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email));
    const [target] = await db
        .select({ id: cafe.id, chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .where(eq(cafe.slug, slug));
    expect(owner, `seeded owner ${email} is missing`).toBeDefined();
    expect(target, `seeded cafe ${slug} is missing`).toBeDefined();
    expect(target?.chainCafeId, `cafe ${slug} has no chain id`).not.toBeNull();
    if (!owner || !target || target.chainCafeId === null) {
        throw new Error(`live fixture ${slug} is incomplete`);
    }
    return {
        ownerId: owner.id,
        cafeId: target.id,
        chainCafeId: target.chainCafeId,
    };
}

describeLive("plan payment on a live chain", () => {
    it("buys a pack, moves the configured split and credits the cafe", async () => {
        const target = await findCafeOwner(
            "esquina-sur",
            "esquinasur@punch.pe",
        );
        const beforeBalances = await readBalances();
        const beforeStatus = await getPlanStatusService(
            target.ownerId,
            target.cafeId,
        );
        expect(beforeStatus.ok).toBe(true);
        if (!beforeStatus.ok) throw new Error("could not read plan status");
        expect(beforeStatus.data.planActive).toBe(true);
        await runIndexerOnce();

        const [beforeCredit] = await db
            .select({ credits: projectionCafeCredit.credits })
            .from(projectionCafeCredit)
            .where(eq(projectionCafeCredit.chainCafeId, target.chainCafeId));
        expect(beforeCredit).toBeDefined();

        const created = await createPlanOrderService(target.ownerId, {
            cafeId: target.cafeId,
            kind: "pack",
        });
        expect(
            created.ok,
            created.ok ? undefined : JSON.stringify(created.error),
        ).toBe(true);
        if (!created.ok) throw new Error("pack order creation failed");

        await drainRunner(created.data.id);

        const [row] = await db
            .select()
            .from(planOrder)
            .where(eq(planOrder.id, created.data.id));
        expect(row?.status).toBe("confirmed");
        expect(row?.txHash).toMatch(/^0x[0-9a-f]{64}$/);

        const [afterCredit] = await db
            .select({ credits: projectionCafeCredit.credits })
            .from(projectionCafeCredit)
            .where(eq(projectionCafeCredit.chainCafeId, target.chainCafeId));
        expect(afterCredit?.credits).toBe((beforeCredit?.credits ?? 0n) + 100n);

        const afterBalances = await readBalances();
        const split = PLAN_SPLITS.pack;
        // PlanManager keeps the reserve internally; it does not forward it to
        // the vault until a credit is consumed.
        expect(afterBalances.vault - beforeBalances.vault).toBe(0n);
        expect(afterBalances.fund - beforeBalances.fund).toBe(split.fund);

        const afterStatus = await getPlanStatusService(
            target.ownerId,
            target.cafeId,
        );
        expect(afterStatus.ok).toBe(true);
        if (!afterStatus.ok)
            throw new Error("could not read final plan status");
        expect(afterStatus.data.planActive).toBe(true);
        expect(afterStatus.data.unallocatedReserveSoles).toBe(
            beforeStatus.data.unallocatedReserveSoles +
                Number(split.reserve) / 1_000_000,
        );
    }, 15_000);

    it("refuses a second payment while one is in flight", async () => {
        // This uses a different cafe from the payment test so cleanup cannot
        // consume or otherwise alter the first test's fixture state.
        const target = await findCafeOwner("brujula-cafe", "brujula@punch.pe");
        const first = await createPlanOrderService(target.ownerId, {
            cafeId: target.cafeId,
            kind: "pack",
        });
        expect(
            first.ok,
            first.ok ? undefined : JSON.stringify(first.error),
        ).toBe(true);
        if (!first.ok) throw new Error("first pack order creation failed");

        const second = await createPlanOrderService(target.ownerId, {
            cafeId: target.cafeId,
            kind: "pack",
        });
        expect(second.ok).toBe(false);
        if (second.ok) throw new Error("second payment unexpectedly succeeded");
        expect(second.error.status).toBe(409);

        await drainRunner(first.data.id);
        const [confirmed] = await db
            .select({ status: planOrder.status })
            .from(planOrder)
            .where(eq(planOrder.id, first.data.id));
        expect(confirmed?.status).toBe("confirmed");
    }, 15_000);
});
