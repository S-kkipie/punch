import "server-only";

import { and, eq } from "drizzle-orm";
import { applyChainPurchaseEffects } from "@/core/punch/server/repository/chain-purchase-effects";
import {
    consumerTransaction,
    consumptionProof,
} from "@/server/drizzle/schemas/consumption-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import type { IndexerTransaction } from "./apply-event";

export type ConfirmedConsumptionProjectionInput = {
    orderId: string;
    txHash: `0x${string}`;
    logIndex: number;
    blockNumber: bigint;
    confirmedAt?: Date;
};

export async function applyConfirmedConsumptionProjection(
    tx: IndexerTransaction,
    input: ConfirmedConsumptionProjectionInput,
): Promise<void> {
    const [order] = await tx
        .select()
        .from(purchaseOrder)
        .where(eq(purchaseOrder.id, input.orderId));
    if (!order || order.status === "failed" || order.status === "expired") {
        return;
    }
    const confirmedAt = input.confirmedAt ?? new Date();

    await tx
        .update(purchaseOrder)
        .set({ status: "confirmed", txHash: input.txHash })
        .where(
            and(
                eq(purchaseOrder.id, order.id),
                eq(purchaseOrder.status, order.status),
            ),
        );

    const [quote] = await tx
        .select()
        .from(consumptionProof)
        .where(eq(consumptionProof.purchaseOrderId, order.id));
    if (!quote) return;

    await tx
        .update(consumptionProof)
        .set({ status: "confirmed", receiptHash: order.receiptHash })
        .where(eq(consumptionProof.id, quote.id));

    await tx
        .insert(consumerTransaction)
        .values({
            id: `chain_emission:${order.id}`,
            operation: "emission",
            consumerUserId: order.userId,
            cafeId: order.cafeId,
            proofId: quote.id,
            chainTxId: input.txHash,
            status: "confirmed",
            idempotencyKey: `chain_emission:${order.id}`,
            purchaseOrderId: order.id,
            transactionHash: input.txHash,
            chainBlockNumber: input.blockNumber,
            logIndex: input.logIndex,
            createdAt: confirmedAt,
        })
        .onConflictDoNothing({
            target: consumerTransaction.idempotencyKey,
        });

    await applyChainPurchaseEffects(tx, {
        purchaseOrderId: order.id,
        consumerUserId: order.userId,
        cafeId: order.cafeId,
        productId: order.productId,
        transactionHash: input.txHash,
        logIndex: input.logIndex,
        blockNumber: input.blockNumber,
        confirmedAt,
    });
}
