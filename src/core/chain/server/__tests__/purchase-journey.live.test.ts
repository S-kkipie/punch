import { eq } from "drizzle-orm";
import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { seedHistoricalConsumptions } from "@/core/chain/server/bootstrap-local/historical-consumptions";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import { runReconcilerOnce } from "@/core/chain/server/reconciler/reconciler";
import {
    recoverStuckJobs,
    runRelayerOnce,
} from "@/core/chain/server/relayer/relayer";
import { createPurchaseProofService } from "@/core/consumption/server/services/create-purchase-proof-service";
import { confirmQuoteService } from "@/core/purchase/server/services/confirm-quote-service";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import { projectionPunchBalance } from "@/server/drizzle/schemas/chain-schema";
import { consumerTransaction } from "@/server/drizzle/schemas/consumption-schema";
import {
    chainPurchaseEffect,
    consumerCrawlProgress,
    consumerVoucher,
    punchBalanceProjection,
} from "@/server/drizzle/schemas/punch-schema";
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";

const live =
    process.env.PUNCH_RUN_INTEGRATION === "1" &&
    process.env.PUNCH_RUN_LIVE_CHAIN === "1";
const describeLive = describe.skipIf(!live);
const yapeRef = `LIVE-SECRET-${crypto.randomUUID()}`;

let consumerId = "";
let consumerWalletAddress = "";
let baristaId = "";
let cafeId = "";
let productId = "";
let orderId = "";

async function findFixture() {
    const [consumer] = await db
        .select({ id: user.id, walletAddress: user.walletAddress })
        .from(user)
        .where(eq(user.email, "demo-consumer@punch.pe"));
    const [barista] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, "esquinasur@punch.pe"));
    const [targetCafe] = await db
        .select({ id: cafe.id })
        .from(cafe)
        .where(eq(cafe.slug, "esquina-sur"));
    if (!consumer || !barista || !targetCafe) {
        throw new Error("live journey seed precondition is missing");
    }
    const [product] = await db
        .select({ id: cafeProduct.id })
        .from(cafeProduct)
        .where(eq(cafeProduct.cafeId, targetCafe.id))
        .limit(1);
    if (!product) {
        throw new Error("live journey target product is missing");
    }
    if (!consumer.walletAddress) throw new Error("consumer wallet is missing");
    consumerId = consumer.id;
    consumerWalletAddress = consumer.walletAddress;
    baristaId = barista.id;
    cafeId = targetCafe.id;
    productId = product.id;
}

describeLive("live purchase journey and projection recovery", () => {
    beforeAll(async () => {
        await findFixture();
        await seedHistoricalConsumptions({
            consumerUserId: consumerId,
            count: 11,
            targetCafeId: cafeId,
        });
        const chain = createPublicClient({
            chain: foundry,
            transport: http(
                process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545",
            ),
        });
        await chain.request({
            method: "anvil_setTime",
            params: [Date.now()],
        } as never);
        await chain.request({ method: "evm_mine", params: [] } as never);
        await runIndexerOnce();
    });

    it("confirms once on chain, applies effects once, and rebuilds after drift", async () => {
        const logs: string[] = [];
        const logSpies = ["log", "warn", "error"].map((method) =>
            vi.spyOn(console, method as "log").mockImplementation((...args) => {
                logs.push(args.map(String).join(" "));
            }),
        );
        try {
            const before = await db
                .select({ balance: punchBalanceProjection.balance })
                .from(punchBalanceProjection)
                .where(eq(punchBalanceProjection.userId, consumerId));
            expect(before.reduce((sum, row) => sum + row.balance, 0)).toBe(11);

            await db
                .update(cafeProduct)
                .set({ priceSoles: "8.00" })
                .where(eq(cafeProduct.id, productId));
            const issued = await createPurchaseProofService(baristaId, cafeId, {
                productId,
                yapeRef,
            });
            expect(
                issued.ok,
                issued.ok ? undefined : JSON.stringify(issued.error),
            ).toBe(true);
            if (!issued.ok) throw new Error("quote issuance failed");
            expect(issued.data.deepLink).toContain(issued.data.id);
            expect(JSON.stringify(issued.data)).not.toContain(yapeRef);

            const first = await confirmQuoteService(consumerId, issued.data.id);
            expect(first.ok).toBe(true);
            if (!first.ok) throw new Error("first quote confirmation failed");
            const second = await confirmQuoteService(
                consumerId,
                issued.data.id,
            );
            expect(second.ok).toBe(true);
            if (!second.ok)
                throw new Error("duplicate quote confirmation failed");
            expect(second.data.order.id).toBe(first.data.order.id);
            expect(second.data.outcome).toBe("existing");
            expect(JSON.stringify(first.data)).not.toContain(yapeRef);
            expect(JSON.stringify(second.data)).not.toContain(yapeRef);
            orderId = first.data.order.id;

            const queued = await db
                .select({ status: purchaseOrder.status })
                .from(purchaseOrder)
                .where(eq(purchaseOrder.id, orderId));
            expect(queued[0]?.status).toBe("queued");
            expect(
                await db
                    .select({ id: relayerJob.id })
                    .from(relayerJob)
                    .where(eq(relayerJob.orderId, orderId)),
            ).toHaveLength(1);

            await runRelayerOnce();
            await runIndexerOnce();

            const confirmed = await db
                .select({ status: purchaseOrder.status })
                .from(purchaseOrder)
                .where(eq(purchaseOrder.id, orderId));
            expect(confirmed[0]?.status).toBe("confirmed");
            const balance = await db
                .select({ balance: projectionPunchBalance.balance })
                .from(projectionPunchBalance)
                .where(
                    eq(
                        projectionPunchBalance.userAddress,
                        consumerWalletAddress.toLowerCase(),
                    ),
                );
            expect(balance.reduce((sum, row) => sum + row.balance, 0n)).toBe(
                12n,
            );
            expect(
                await db
                    .select({ id: chainPurchaseEffect.id })
                    .from(chainPurchaseEffect)
                    .where(eq(chainPurchaseEffect.purchaseOrderId, orderId)),
            ).toHaveLength(2);
            expect(
                await db
                    .select({ id: consumerVoucher.id })
                    .from(consumerVoucher)
                    .where(eq(consumerVoucher.consumerUserId, consumerId)),
            ).toHaveLength(2);
            const [crawl] = await db
                .select({ completed: consumerCrawlProgress.completedCafeIds })
                .from(consumerCrawlProgress)
                .where(eq(consumerCrawlProgress.consumerUserId, consumerId));
            expect(crawl?.completed).toHaveLength(3);

            await recoverStuckJobs();
            await runRelayerOnce();
            const stable = await db
                .select({ status: purchaseOrder.status })
                .from(purchaseOrder)
                .where(eq(purchaseOrder.id, orderId));
            expect(stable[0]?.status).toBe("confirmed");

            await db
                .update(projectionPunchBalance)
                .set({ balance: 999n })
                .where(
                    eq(
                        projectionPunchBalance.userAddress,
                        consumerWalletAddress.toLowerCase(),
                    ),
                );
            const repaired = await runReconcilerOnce();
            expect(repaired).toEqual({ diverged: true, repaired: true });
            const afterRepair = await db
                .select({ balance: projectionPunchBalance.balance })
                .from(projectionPunchBalance)
                .where(
                    eq(
                        projectionPunchBalance.userAddress,
                        consumerWalletAddress.toLowerCase(),
                    ),
                );
            expect(
                afterRepair.reduce((sum, row) => sum + row.balance, 0n),
            ).toBe(12n);
            expect(
                await db
                    .select({ id: chainPurchaseEffect.id })
                    .from(chainPurchaseEffect)
                    .where(eq(chainPurchaseEffect.purchaseOrderId, orderId)),
            ).toHaveLength(2);
            expect(
                await db
                    .select({ id: consumerTransaction.id })
                    .from(consumerTransaction)
                    .where(eq(consumerTransaction.purchaseOrderId, orderId)),
            ).toHaveLength(1);

            expect(logs.join("\n")).not.toContain(yapeRef);
            expect(logs.join("\n")).not.toMatch(/0x[0-9a-f]{130}/i);
        } finally {
            for (const spy of logSpies) spy.mockRestore();
        }
    });
});
