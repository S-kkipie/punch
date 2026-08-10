import { and, eq, inArray } from "drizzle-orm";
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
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";

installIntegrationDbMutex();
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

    it("uses exact transaction identity to heal late events without misassigning mismatched products", async () => {
        const suffix = crypto.randomUUID();
        const userId = `exact-user-${suffix}`;
        const cafeId = `exact-cafe-${suffix}`;
        const productAId = `exact-product-a-${suffix}`;
        const productBId = `exact-product-b-${suffix}`;
        const requestAId = `exact-request-a-${suffix}`;
        const requestBId = `exact-request-b-${suffix}`;
        const requestCId = `exact-request-c-${suffix}`;
        const wallet = "0x0000000000000000000000000000000000000aad";
        const exactTxHash = `0x${"4".repeat(64)}`;
        const mismatchTxHash = `0x${"5".repeat(64)}`;
        await db.insert(user).values({
            id: userId,
            name: "Exact User",
            email: `${suffix}@example.test`,
            walletAddress: wallet,
        });
        await db.insert(cafe).values({
            id: cafeId,
            name: "Exact Cafe",
            slug: `exact-${suffix}`,
            chainCafeId: 3,
        });
        await db.insert(cafeProduct).values([
            {
                id: productAId,
                cafeId,
                name: "Reward A",
                priceSoles: "12.00",
                type: "reward",
                approvalStatus: "approved",
                chainProductId: 7,
            },
            {
                id: productBId,
                cafeId,
                name: "Reward B",
                priceSoles: "12.00",
                type: "reward",
                approvalStatus: "approved",
                chainProductId: 8,
            },
        ]);
        await db.insert(redemptionRequest).values([
            {
                id: requestAId,
                kind: "punch_reward",
                consumerUserId: userId,
                cafeId,
                productId: productAId,
                status: "failed",
                failureReason: "receipt polling exhausted",
            },
            {
                id: requestBId,
                kind: "punch_reward",
                consumerUserId: userId,
                cafeId,
                productId: productBId,
                status: "approved",
            },
            {
                id: requestCId,
                kind: "punch_reward",
                consumerUserId: userId,
                cafeId,
                productId: productAId,
                status: "failed",
                failureReason: "receipt polling exhausted",
            },
        ]);
        await db.insert(relayerJob).values([
            {
                id: `exact-job-a-${suffix}`,
                kind: "punch_redemption",
                redemptionRequestId: requestAId,
                payload: {
                    userWallet: wallet,
                    chainCafeId: 3,
                    chainProductId: 7,
                },
                status: "confirmed",
                txHash: exactTxHash,
            },
            {
                id: `exact-job-c-${suffix}`,
                kind: "punch_redemption",
                redemptionRequestId: requestCId,
                payload: {
                    userWallet: wallet,
                    chainCafeId: 3,
                    chainProductId: 7,
                },
                status: "confirmed",
                txHash: mismatchTxHash,
            },
        ]);
        await db.insert(projectionPunchBalance).values({
            userAddress: wallet,
            balance: 24n,
            lastBlock: 1n,
        });
        try {
            await db.transaction((tx) =>
                applyEvent(tx, {
                    eventName: "RewardRedeemed",
                    args: { user: wallet, hostCafeId: 3n, productId: 7n },
                    blockNumber: 10n,
                    transactionHash: exactTxHash,
                    logIndex: 2,
                    transactionIndex: 0,
                }),
            );
            await db.transaction((tx) =>
                applyEvent(tx, {
                    eventName: "RewardRedeemed",
                    args: { user: wallet, hostCafeId: 3n, productId: 8n },
                    blockNumber: 11n,
                    transactionHash: mismatchTxHash,
                    logIndex: 3,
                    transactionIndex: 0,
                }),
            );

            const requests = await db
                .select({
                    id: redemptionRequest.id,
                    status: redemptionRequest.status,
                })
                .from(redemptionRequest)
                .where(
                    inArray(redemptionRequest.id, [
                        requestAId,
                        requestBId,
                        requestCId,
                    ]),
                );
            expect(requests).toEqual(
                expect.arrayContaining([
                    { id: requestAId, status: "confirmed" },
                    { id: requestBId, status: "approved" },
                    { id: requestCId, status: "failed" },
                ]),
            );
            expect(
                await db
                    .select()
                    .from(consumerTransaction)
                    .where(
                        eq(consumerTransaction.redemptionRequestId, requestAId),
                    ),
            ).toHaveLength(1);
            expect(
                await db
                    .select()
                    .from(consumerTransaction)
                    .where(
                        eq(consumerTransaction.redemptionRequestId, requestBId),
                    ),
            ).toHaveLength(0);
            expect(
                await db
                    .select()
                    .from(consumerTransaction)
                    .where(
                        eq(consumerTransaction.redemptionRequestId, requestCId),
                    ),
            ).toHaveLength(0);
            expect(
                await db
                    .select()
                    .from(projectionChainEvent)
                    .where(eq(projectionChainEvent.txHash, mismatchTxHash)),
            ).toHaveLength(1);
        } finally {
            await db
                .delete(consumerTransaction)
                .where(eq(consumerTransaction.consumerUserId, userId));
            await db
                .delete(projectionChainEvent)
                .where(eq(projectionChainEvent.txHash, mismatchTxHash));
            await db
                .delete(projectionCafePayout)
                .where(eq(projectionCafePayout.cafeId, cafeId));
            await db
                .delete(projectionPunchBalance)
                .where(eq(projectionPunchBalance.userAddress, wallet));
            await db
                .delete(relayerJob)
                .where(
                    inArray(relayerJob.redemptionRequestId, [
                        requestAId,
                        requestCId,
                    ]),
                );
            await db
                .delete(redemptionRequest)
                .where(
                    inArray(redemptionRequest.id, [
                        requestAId,
                        requestBId,
                        requestCId,
                    ]),
                );
            await db
                .delete(cafeProduct)
                .where(inArray(cafeProduct.id, [productAId, productBId]));
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
            const event = {
                eventName: "RewardRedeemed" as const,
                args: { user: wallet, hostCafeId: 3n, productId: 7n },
                blockNumber: 10n,
                transactionHash: `0x${"3".repeat(64)}`,
                logIndex: 2,
                transactionIndex: 0,
            };
            await db.transaction((tx) => applyEvent(tx, event));
            await db.transaction((tx) => applyEvent(tx, event));
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
                .delete(projectionChainEvent)
                .where(eq(projectionChainEvent.txHash, `0x${"3".repeat(64)}`));
            await db
                .delete(projectionPunchBalance)
                .where(eq(projectionPunchBalance.userAddress, wallet));
        }
    });
});
