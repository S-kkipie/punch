import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applyEvent } from "@/core/chain/server/indexer/apply-event";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import {
    projectionCafePayout,
    projectionChainEvent,
    projectionPunchBalance,
} from "@/server/drizzle/schemas/chain-schema";
import {
    consumerTransaction,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";

const run =
    process.env.PUNCH_RUN_INTEGRATION === "1" ? describe : describe.skip;

run("redemption projection", () => {
    it("RewardRedeemed decrements balance, confirms request, and records payout", async () => {
        const suffix = crypto.randomUUID();
        const userId = `redemption-user-${suffix}`;
        const cafeId = `redemption-cafe-${suffix}`;
        const productId = `redemption-product-${suffix}`;
        const requestId = `redemption-request-${suffix}`;
        const wallet = "0x0000000000000000000000000000000000000aaa";
        const txHash = `0x${"1".repeat(64)}`;
        await db.insert(user).values({
            id: userId,
            name: "Redemption User",
            email: `${suffix}@example.test`,
            walletAddress: wallet,
        });
        await db.insert(cafe).values({
            id: cafeId,
            name: "Redemption Cafe",
            slug: `redemption-${suffix}`,
            chainCafeId: 3,
        });
        await db.insert(cafeProduct).values({
            id: productId,
            cafeId,
            name: "Reward",
            priceSoles: "12.00",
            type: "reward",
            approvalStatus: "approved",
            chainProductId: 7,
        });
        await db.insert(redemptionRequest).values({
            id: requestId,
            kind: "punch_reward",
            consumerUserId: userId,
            cafeId,
            productId,
            status: "approved",
        });
        await db
            .insert(projectionPunchBalance)
            .values({ userAddress: wallet, balance: 12n, lastBlock: 1n });
        try {
            await db.transaction((tx) =>
                applyEvent(tx, {
                    eventName: "RewardRedeemed",
                    args: { user: wallet, hostCafeId: 3n, productId: 7n },
                    blockNumber: 10n,
                    transactionHash: txHash,
                    logIndex: 2,
                    transactionIndex: 0,
                }),
            );
            const [balance] = await db
                .select()
                .from(projectionPunchBalance)
                .where(eq(projectionPunchBalance.userAddress, wallet));
            const [request] = await db
                .select()
                .from(redemptionRequest)
                .where(eq(redemptionRequest.id, requestId));
            const [payout] = await db
                .select()
                .from(projectionCafePayout)
                .where(eq(projectionCafePayout.cafeId, cafeId));
            const [ledger] = await db
                .select()
                .from(consumerTransaction)
                .where(
                    eq(
                        consumerTransaction.idempotencyKey,
                        `chain_redemption:${requestId}`,
                    ),
                );
            expect(balance?.balance).toBe(0n);
            expect(request?.status).toBe("confirmed");
            expect(payout).toMatchObject({
                totalCentimos: 360,
                redemptionCount: 1,
            });
            expect(ledger).toMatchObject({
                operation: "punch_redemption",
                status: "confirmed",
                transactionHash: txHash,
                logIndex: 2,
            });
        } finally {
            await db
                .delete(consumerTransaction)
                .where(eq(consumerTransaction.consumerUserId, userId));
            await db
                .delete(projectionCafePayout)
                .where(eq(projectionCafePayout.cafeId, cafeId));
            await db
                .delete(projectionPunchBalance)
                .where(eq(projectionPunchBalance.userAddress, wallet));
            await db
                .delete(redemptionRequest)
                .where(eq(redemptionRequest.id, requestId));
            await db.delete(cafeProduct).where(eq(cafeProduct.id, productId));
            await db.delete(cafe).where(eq(cafe.id, cafeId));
            await db.delete(user).where(eq(user.id, userId));
        }
    });

    it("replaying the same event does not double-count balance or payout", async () => {
        const suffix = crypto.randomUUID();
        const userId = `replay-user-${suffix}`;
        const cafeId = `replay-cafe-${suffix}`;
        const productId = `replay-product-${suffix}`;
        const requestId = `replay-request-${suffix}`;
        const wallet = "0x0000000000000000000000000000000000000aab";
        const event = {
            eventName: "RewardRedeemed" as const,
            args: { user: wallet, hostCafeId: 3n, productId: 7n },
            blockNumber: 10n,
            transactionHash: `0x${"2".repeat(64)}`,
            logIndex: 2,
            transactionIndex: 0,
        };
        await db.insert(user).values({
            id: userId,
            name: "Replay User",
            email: `${suffix}@example.test`,
            walletAddress: wallet,
        });
        await db.insert(cafe).values({
            id: cafeId,
            name: "Replay Cafe",
            slug: `replay-${suffix}`,
            chainCafeId: 3,
        });
        await db.insert(cafeProduct).values({
            id: productId,
            cafeId,
            name: "Reward",
            priceSoles: "12.00",
            type: "reward",
            approvalStatus: "approved",
            chainProductId: 7,
        });
        await db.insert(redemptionRequest).values({
            id: requestId,
            kind: "punch_reward",
            consumerUserId: userId,
            cafeId,
            productId,
            status: "approved",
        });
        await db
            .insert(projectionPunchBalance)
            .values({ userAddress: wallet, balance: 12n, lastBlock: 1n });
        try {
            await db.transaction((tx) => applyEvent(tx, event));
            await db.transaction((tx) => applyEvent(tx, event));
            const [balance] = await db
                .select()
                .from(projectionPunchBalance)
                .where(eq(projectionPunchBalance.userAddress, wallet));
            const [payout] = await db
                .select()
                .from(projectionCafePayout)
                .where(eq(projectionCafePayout.cafeId, cafeId));
            expect(balance?.balance).toBe(0n);
            expect(payout).toMatchObject({
                totalCentimos: 360,
                redemptionCount: 1,
            });
        } finally {
            await db
                .delete(consumerTransaction)
                .where(eq(consumerTransaction.consumerUserId, userId));
            await db
                .delete(projectionCafePayout)
                .where(eq(projectionCafePayout.cafeId, cafeId));
            await db
                .delete(projectionPunchBalance)
                .where(eq(projectionPunchBalance.userAddress, wallet));
            await db
                .delete(redemptionRequest)
                .where(eq(redemptionRequest.id, requestId));
            await db.delete(cafeProduct).where(eq(cafeProduct.id, productId));
            await db.delete(cafe).where(eq(cafe.id, cafeId));
            await db.delete(user).where(eq(user.id, userId));
        }
    });

    it("without a matching request only decrements balance", async () => {
        const wallet = "0x0000000000000000000000000000000000000aac";
        await db
            .insert(projectionPunchBalance)
            .values({ userAddress: wallet, balance: 12n, lastBlock: 1n });
        try {
            await db.transaction((tx) =>
                applyEvent(tx, {
                    eventName: "RewardRedeemed",
                    args: { user: wallet, hostCafeId: 3n, productId: 7n },
                    blockNumber: 10n,
                    transactionHash: `0x${"3".repeat(64)}`,
                    logIndex: 2,
                    transactionIndex: 0,
                }),
            );
            const [balance] = await db
                .select()
                .from(projectionPunchBalance)
                .where(eq(projectionPunchBalance.userAddress, wallet));
            expect(balance?.balance).toBe(0n);
            expect(
                await db
                    .select()
                    .from(consumerTransaction)
                    .where(
                        and(
                            eq(
                                consumerTransaction.operation,
                                "punch_redemption",
                            ),
                            eq(
                                consumerTransaction.transactionHash,
                                `0x${"3".repeat(64)}`,
                            ),
                        ),
                    ),
            ).toHaveLength(0);
            expect(
                await db
                    .select()
                    .from(projectionChainEvent)
                    .where(
                        eq(projectionChainEvent.txHash, `0x${"3".repeat(64)}`),
                    ),
            ).toHaveLength(1);
        } finally {
            await db
                .delete(projectionPunchBalance)
                .where(eq(projectionPunchBalance.userAddress, wallet));
        }
    });
});
