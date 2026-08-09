// biome-ignore-all lint/suspicious/noExplicitAny: fake transaction mirrors Drizzle's generic transaction builder
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyChainPurchaseEffects } from "@/core/punch/server/repository/chain-purchase-effects";
import {
    consumerTransaction,
    consumptionProof,
} from "@/server/drizzle/schemas/consumption-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import { applyConfirmedConsumptionProjection } from "../purchase-projection";

vi.mock("@/core/punch/server/repository/chain-purchase-effects", () => ({
    applyChainPurchaseEffects: vi.fn(),
}));

const txHash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
const order = {
    id: "order-1",
    status: "submitted",
    userId: "consumer-1",
    cafeId: "cafe-1",
    productId: "product-1",
    receiptHash: "receipt-hash",
};
const quote = { id: "quote-1", purchaseOrderId: order.id };

function txFor(rows: unknown[]) {
    return {
        select: vi.fn(() => ({
            from: vi.fn((table: unknown) => ({
                innerJoin: vi.fn(() => ({
                    where: vi.fn().mockResolvedValue(rows),
                })),
                where: vi
                    .fn()
                    .mockResolvedValue(
                        rows.length === 0
                            ? []
                            : table === purchaseOrder
                              ? [order]
                              : [quote],
                    ),
            })),
        })),
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn().mockResolvedValue([]),
            })),
        })),
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                onConflictDoNothing: vi.fn().mockResolvedValue([]),
            })),
        })),
    } as any;
}

describe("applyConfirmedConsumptionProjection", () => {
    beforeEach(() => vi.clearAllMocks());

    it("confirms the linked order and quote, records history, and applies effects once", async () => {
        const tx = txFor([order]);

        await applyConfirmedConsumptionProjection(tx, {
            orderId: order.id,
            txHash,
            logIndex: 3,
            blockNumber: 42n,
        });

        expect(tx.update).toHaveBeenCalledWith(purchaseOrder);
        expect(tx.update.mock.results[0].value.set).toHaveBeenCalledWith({
            status: "confirmed",
            txHash,
        });
        expect(tx.update).toHaveBeenCalledWith(consumptionProof);
        expect(tx.update.mock.results[1].value.set).toHaveBeenCalledWith({
            status: "confirmed",
            receiptHash: order.receiptHash,
        });
        expect(tx.insert).toHaveBeenCalledWith(consumerTransaction);
        expect(tx.insert.mock.results[0].value.values).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: "emission",
                consumerUserId: order.userId,
                cafeId: order.cafeId,
                proofId: quote.id,
                chainTxId: txHash,
                status: "confirmed",
                idempotencyKey: `chain_emission:${order.id}`,
                purchaseOrderId: order.id,
                transactionHash: txHash,
                logIndex: 3,
                createdAt: expect.any(Date),
            }),
        );
        expect(applyChainPurchaseEffects).toHaveBeenCalledTimes(1);
        expect(applyChainPurchaseEffects).toHaveBeenCalledWith(
            tx,
            expect.objectContaining({
                purchaseOrderId: order.id,
                consumerUserId: order.userId,
                cafeId: order.cafeId,
                productId: order.productId,
                transactionHash: txHash,
                logIndex: 3,
            }),
        );
    });

    it("does not invent consumer effects when no order matches", async () => {
        const tx = txFor([]);

        await applyConfirmedConsumptionProjection(tx, {
            orderId: "missing-order",
            txHash,
            logIndex: 3,
            blockNumber: 42n,
        });

        expect(applyChainPurchaseEffects).not.toHaveBeenCalled();
        expect(tx.insert).not.toHaveBeenCalledWith(consumerTransaction);
    });
});
