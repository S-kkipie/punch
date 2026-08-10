import "server-only";

import { and, eq, sql } from "drizzle-orm";
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
import type { IndexerTransaction } from "./apply-event";

export const PUNCHES_PER_REWARD = 12n;
export const HOST_PAYOUT_CENTIMOS = 360;

type RewardInput = {
    userAddress: string;
    chainCafeId: number;
    chainProductId?: number;
    txHash: string;
    logIndex: number;
    blockNumber: bigint;
};

async function findMatch(tx: IndexerTransaction, input: RewardInput) {
    const [exact] = await tx
        .select({
            requestId: redemptionRequest.id,
            consumerUserId: redemptionRequest.consumerUserId,
            cafeId: redemptionRequest.cafeId,
        })
        .from(relayerJob)
        .innerJoin(
            redemptionRequest,
            eq(redemptionRequest.id, relayerJob.redemptionRequestId),
        )
        .innerJoin(user, eq(user.id, redemptionRequest.consumerUserId))
        .innerJoin(cafe, eq(cafe.id, redemptionRequest.cafeId))
        .innerJoin(cafeProduct, eq(cafeProduct.id, redemptionRequest.productId))
        .where(
            and(
                eq(relayerJob.kind, "punch_redemption"),
                eq(relayerJob.txHash, input.txHash),
                eq(cafe.chainCafeId, input.chainCafeId),
                ...(input.chainProductId === undefined
                    ? []
                    : [eq(cafeProduct.chainProductId, input.chainProductId)]),
                sql`lower(${user.walletAddress}) = ${input.userAddress}`,
            ),
        )
        .limit(1);
    if (exact) return exact;
    const [knownTx] = await tx
        .select({ id: relayerJob.id })
        .from(relayerJob)
        .where(
            and(
                eq(relayerJob.kind, "punch_redemption"),
                eq(relayerJob.txHash, input.txHash),
            ),
        )
        .limit(1);
    // A known redemption transaction with mismatched event payload must never
    // fall through to another request.
    if (knownTx) return undefined;

    const [fallback] = await tx
        .select({
            requestId: redemptionRequest.id,
            consumerUserId: redemptionRequest.consumerUserId,
            cafeId: redemptionRequest.cafeId,
        })
        .from(redemptionRequest)
        .innerJoin(user, eq(user.id, redemptionRequest.consumerUserId))
        .innerJoin(cafe, eq(cafe.id, redemptionRequest.cafeId))
        .innerJoin(cafeProduct, eq(cafeProduct.id, redemptionRequest.productId))
        .where(
            and(
                eq(redemptionRequest.kind, "punch_reward"),
                eq(redemptionRequest.status, "approved"),
                eq(cafe.chainCafeId, input.chainCafeId),
                ...(input.chainProductId === undefined
                    ? []
                    : [eq(cafeProduct.chainProductId, input.chainProductId)]),
                sql`lower(${user.walletAddress}) = ${input.userAddress}`,
            ),
        )
        .orderBy(redemptionRequest.createdAt)
        .limit(1);
    return fallback;
}

export async function applyRewardRedeemedProjection(
    tx: IndexerTransaction,
    input: RewardInput,
): Promise<void> {
    const [processed] = await tx
        .select({ id: consumerTransaction.id })
        .from(consumerTransaction)
        .where(
            and(
                eq(consumerTransaction.operation, "punch_redemption"),
                eq(consumerTransaction.transactionHash, input.txHash),
                eq(consumerTransaction.logIndex, input.logIndex),
            ),
        )
        .limit(1);
    if (processed) return;

    const match = await findMatch(tx, input);
    if (!match) {
        const marker = await tx
            .insert(projectionChainEvent)
            .values({
                txHash: input.txHash,
                logIndex: input.logIndex,
                eventName: "RewardRedeemed",
            })
            .onConflictDoNothing({
                target: [
                    projectionChainEvent.txHash,
                    projectionChainEvent.logIndex,
                ],
            })
            .returning({ txHash: projectionChainEvent.txHash });
        if (marker.length === 0) return;
        await decrementBalance(tx, input);
        return;
    }

    const inserted = await tx
        .insert(consumerTransaction)
        .values({
            id: `chain_redemption:${match.requestId}`,
            operation: "punch_redemption",
            consumerUserId: match.consumerUserId,
            cafeId: match.cafeId,
            redemptionRequestId: match.requestId,
            chainTxId: input.txHash,
            status: "confirmed",
            idempotencyKey: `chain_redemption:${match.requestId}`,
            transactionHash: input.txHash,
            chainBlockNumber: input.blockNumber,
            logIndex: input.logIndex,
            modeledHostPayoutCentimos: HOST_PAYOUT_CENTIMOS,
        })
        .onConflictDoNothing({ target: consumerTransaction.idempotencyKey })
        .returning({ id: consumerTransaction.id });
    if (inserted.length === 0) return;

    await decrementBalance(tx, input);
    await tx
        .update(redemptionRequest)
        .set({ status: "confirmed", failureReason: null })
        .where(eq(redemptionRequest.id, match.requestId));
    await tx
        .insert(projectionCafePayout)
        .values({
            cafeId: match.cafeId,
            totalCentimos: HOST_PAYOUT_CENTIMOS,
            redemptionCount: 1,
        })
        .onConflictDoUpdate({
            target: projectionCafePayout.cafeId,
            set: {
                totalCentimos: sql`${projectionCafePayout.totalCentimos} + ${HOST_PAYOUT_CENTIMOS}`,
                redemptionCount: sql`${projectionCafePayout.redemptionCount} + 1`,
            },
        });
}

async function decrementBalance(
    tx: IndexerTransaction,
    input: { userAddress: string; blockNumber: bigint },
): Promise<void> {
    await tx
        .update(projectionPunchBalance)
        .set({
            balance: sql`${projectionPunchBalance.balance} - ${PUNCHES_PER_REWARD}`,
            lastBlock: sql`GREATEST(${projectionPunchBalance.lastBlock}, ${input.blockNumber})`,
        })
        .where(eq(projectionPunchBalance.userAddress, input.userAddress));
}
