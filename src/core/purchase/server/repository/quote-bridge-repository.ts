import "server-only";

import { and, eq } from "drizzle-orm";
import {
    type ConsumptionProof,
    serializeProof,
} from "@/core/chain/server/proof/proof";
import { maskYapeRef } from "@/core/consumption/domain/quotes";
import type { PurchaseQuoteView } from "@/core/consumption/domain/types";
import type {
    PurchaseOrderView,
    QuoteBridgeResult,
} from "@/core/purchase/domain/types";
import { type DbClient, db } from "@/server/drizzle/db";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import { consumptionProof } from "@/server/drizzle/schemas/consumption-schema";
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";

export type QuoteForBridge = typeof consumptionProof.$inferSelect & {
    chainCafeId: number | null;
    chainProductId: number | null;
};

function toOrderView(
    row: typeof purchaseOrder.$inferSelect,
): PurchaseOrderView {
    return {
        id: row.id,
        cafeId: row.cafeId,
        productId: row.productId,
        amountSoles: Number(row.amount) / 1_000_000,
        status: row.status,
        failureReason: row.failureReason,
        txHash: row.txHash,
        expiry: row.expiry.toISOString(),
        createdAt: row.createdAt.toISOString(),
    };
}

function toQuoteView(
    row: typeof consumptionProof.$inferSelect,
): PurchaseQuoteView {
    return {
        id: row.id,
        cafeId: row.cafeId,
        productId: row.productId,
        amountCentimos: row.amountCentimos,
        expiresAt: row.expiresAt.toISOString(),
        status: row.status,
        maskedYapeRef: maskYapeRef(row.yapeRef),
        purchaseOrderId: row.purchaseOrderId,
        failureReason: row.failureReason,
        createdAt: row.createdAt.toISOString(),
    };
}

async function loadExistingBridge(
    client: DbClient,
    quote: typeof consumptionProof.$inferSelect,
): Promise<QuoteBridgeResult> {
    if (!quote.purchaseOrderId) {
        throw new Error("quote bridge missing purchase order");
    }
    const [order] = await client
        .select()
        .from(purchaseOrder)
        .where(eq(purchaseOrder.id, quote.purchaseOrderId));
    if (!order) throw new Error("quote bridge order not found");
    return {
        order: toOrderView(order),
        quote: toQuoteView(quote),
        outcome: "existing",
    };
}

export async function findQuoteForBridge(
    quoteId: string,
): Promise<QuoteForBridge | null> {
    const [row] = await db
        .select({
            id: consumptionProof.id,
            cafeId: consumptionProof.cafeId,
            productId: consumptionProof.productId,
            issuedByUserId: consumptionProof.issuedByUserId,
            consumerUserId: consumptionProof.consumerUserId,
            amountCentimos: consumptionProof.amountCentimos,
            purchaseOrderId: consumptionProof.purchaseOrderId,
            yapeRef: consumptionProof.yapeRef,
            receiptHash: consumptionProof.receiptHash,
            nonce: consumptionProof.nonce,
            cafeSignature: consumptionProof.cafeSignature,
            consumerSignature: consumptionProof.consumerSignature,
            failureReason: consumptionProof.failureReason,
            status: consumptionProof.status,
            expiresAt: consumptionProof.expiresAt,
            createdAt: consumptionProof.createdAt,
            updatedAt: consumptionProof.updatedAt,
            chainCafeId: cafe.chainCafeId,
            chainProductId: cafeProduct.chainProductId,
        })
        .from(consumptionProof)
        .innerJoin(cafe, eq(cafe.id, consumptionProof.cafeId))
        .innerJoin(cafeProduct, eq(cafeProduct.id, consumptionProof.productId))
        .where(eq(consumptionProof.id, quoteId));
    return row ?? null;
}

export async function getExistingBridge(
    quote: QuoteForBridge,
): Promise<QuoteBridgeResult> {
    return loadExistingBridge(db, quote);
}

export async function bridgeQuoteToOrder(input: {
    quoteId: string;
    consumerUserId: string;
    now: Date;
    orderId: string;
    proof: ConsumptionProof;
    cafeSignature: `0x${string}`;
    userSignature: `0x${string}`;
}): Promise<QuoteBridgeResult> {
    try {
        return await db.transaction(async (tx) => {
            const [quote] = await tx
                .select()
                .from(consumptionProof)
                .where(eq(consumptionProof.id, input.quoteId))
                .for("update");

            if (!quote) throw new Error("quote not found");
            if (quote.purchaseOrderId) {
                return loadExistingBridge(tx, quote);
            }
            if (
                quote.status !== "issued" ||
                quote.expiresAt.getTime() <= input.now.getTime()
            ) {
                throw new Error("quote is no longer issuable");
            }

            const [order] = await tx
                .insert(purchaseOrder)
                .values({
                    id: input.orderId,
                    cafeId: quote.cafeId,
                    userId: input.consumerUserId,
                    productId: quote.productId,
                    amount: input.proof.amount,
                    yapeRef: quote.yapeRef,
                    receiptHash: input.proof.receiptHash,
                    nonce: input.proof.nonce.toString(),
                    expiry: new Date(Number(input.proof.expiry) * 1000),
                    status: "queued",
                })
                .returning();

            await tx.insert(relayerJob).values({
                orderId: order.id,
                payload: {
                    proof: serializeProof(input.proof),
                    cafeSignature: input.cafeSignature,
                    userSignature: input.userSignature,
                },
            });

            const [updatedQuote] = await tx
                .update(consumptionProof)
                .set({
                    consumerUserId: input.consumerUserId,
                    purchaseOrderId: order.id,
                    receiptHash: input.proof.receiptHash,
                    nonce: input.proof.nonce.toString(),
                    cafeSignature: input.cafeSignature,
                    consumerSignature: input.userSignature,
                    status: "submitted",
                })
                .where(
                    and(
                        eq(consumptionProof.id, input.quoteId),
                        eq(consumptionProof.status, "issued"),
                    ),
                )
                .returning();

            if (!updatedQuote) {
                throw new Error("quote bridge update rejected");
            }

            return {
                order: toOrderView(order),
                quote: toQuoteView(updatedQuote),
                outcome: "created",
            };
        });
    } catch (cause) {
        if ((cause as { code?: string })?.code !== "23505") throw cause;
        const quote = await findQuoteForBridge(input.quoteId);
        if (!quote?.purchaseOrderId) throw cause;
        return getExistingBridge(quote);
    }
}
