import { describe, expect, it, vi } from "vitest";
import { confirmPurchaseService } from "../confirm-purchase-service";

const chainTimestamp = 1_787_773_200n;

const order = {
    id: "order-1",
    cafeId: "cafe-1",
    userId: "buyer-1",
    productId: "prod-1",
    amount: 8_000_000n,
    receiptHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111" as const,
    nonce: "123",
    expiry: new Date(Date.now() + 60_000),
    status: "user_confirmed" as const,
    createdAt: new Date("2026-08-08T12:00:00.000Z"),
    failureReason: null,
    txHash: null,
    chainCafeId: 1,
    chainProductId: 1,
};

function deps(overrides: Record<string, unknown> = {}) {
    const transaction = vi.fn(
        async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
    );
    return {
        getChainTimestamp: vi.fn().mockResolvedValue(chainTimestamp),
        findOrder: vi.fn().mockResolvedValue(order),
        findCafeOwner: vi.fn().mockResolvedValue({ userId: "owner-1" }),
        findUserWallet: vi.fn().mockImplementation(async (userId: string) => {
            if (userId === "buyer-1") {
                return {
                    walletIndex: 5,
                    walletAddress: "0xAb000000000000000000000000000000000000cd",
                };
            }
            return {
                walletIndex: 9,
                walletAddress: "0xDe000000000000000000000000000000000000ad",
            };
        }),
        requireOwner: vi
            .fn()
            .mockResolvedValue({ ok: true, data: { role: "owner" } }),
        signProof: vi.fn().mockResolvedValue("0xsig"),
        updateOrderAndQueue: vi.fn().mockResolvedValue({
            ...order,
            status: "queued",
        }),
        getCurrentOrder: vi
            .fn()
            .mockResolvedValue({ ...order, status: "queued" }),
        transaction,
        ...overrides,
    };
}

describe("confirmPurchaseService", () => {
    it("requires the confirming caller to be the café owner", async () => {
        const d = deps({
            requireOwner: vi.fn().mockResolvedValue({
                ok: false,
                error: { type: "ForbiddenError" },
            }),
        });

        const result = await confirmPurchaseService("worker-1", "order-1", d);

        expect(result.ok).toBe(false);
        expect(d.signProof).not.toHaveBeenCalled();
        expect(d.transaction).not.toHaveBeenCalled();
    });

    it("dual-signs and queues an order in one transaction", async () => {
        const d = deps();
        const result = await confirmPurchaseService("owner-1", "order-1", d);

        expect(result.ok).toBe(true);
        expect(d.signProof).toHaveBeenCalledTimes(2);
        expect(d.signProof).toHaveBeenNthCalledWith(
            1,
            5,
            expect.objectContaining({ cafeId: 1n, productId: 1n }),
        );
        expect(d.signProof).toHaveBeenNthCalledWith(
            2,
            9,
            expect.objectContaining({ cafeId: 1n, productId: 1n }),
        );
        expect(d.updateOrderAndQueue).toHaveBeenCalledTimes(1);
        expect(d.updateOrderAndQueue).toHaveBeenCalledWith(
            "order-1",
            expect.objectContaining({ proof: expect.any(Object) }),
        );
    });

    it("uses the confirming owner wallet when multiple owners exist", async () => {
        const d = deps({
            findCafeOwner: vi.fn().mockResolvedValue({ userId: "owner-2" }),
        });

        const result = await confirmPurchaseService("owner-1", "order-1", d);

        expect(result.ok).toBe(true);
        expect(d.findUserWallet).toHaveBeenCalledWith("owner-1");
        expect(d.findUserWallet).not.toHaveBeenCalledWith("owner-2");
        expect(d.signProof).toHaveBeenNthCalledWith(
            2,
            9,
            expect.objectContaining({ cafeId: 1n, productId: 1n }),
        );
    });

    it("returns current queued state on double confirmation without duplicate work", async () => {
        const d = deps({
            findOrder: vi
                .fn()
                .mockResolvedValue({ ...order, status: "queued" }),
        });

        const result = await confirmPurchaseService("owner-1", "order-1", d);

        expect(result.ok).toBe(true);
        expect(result.ok && result.data.status).toBe("queued");
        expect(d.signProof).not.toHaveBeenCalled();
        expect(d.transaction).not.toHaveBeenCalled();
    });

    it("returns the current expired state when the queue transition loses an expiry race", async () => {
        const d = deps({
            updateOrderAndQueue: vi.fn().mockResolvedValue({
                outcome: "current",
                order: {
                    ...order,
                    status: "expired",
                    expiry: new Date(Date.now() - 1),
                },
            }),
        });

        const result = await confirmPurchaseService("owner-1", "order-1", d);

        expect(result.ok).toBe(false);
        expect(d.signProof).toHaveBeenCalledTimes(2);
    });

    it("returns an expired error and does not sign an expired order", async () => {
        const d = deps({
            findOrder: vi.fn().mockResolvedValue({
                ...order,
                expiry: new Date(Date.now() - 1),
            }),
        });

        const result = await confirmPurchaseService("owner-1", "order-1", d);

        expect(result.ok).toBe(false);
        expect(d.signProof).not.toHaveBeenCalled();
        expect(d.transaction).not.toHaveBeenCalled();
    });

    it("does not expose queued state when the transaction fails", async () => {
        const d = deps({
            updateOrderAndQueue: vi
                .fn()
                .mockRejectedValue(new Error("transaction failed")),
        });

        const result = await confirmPurchaseService("owner-1", "order-1", d);

        expect(result.ok).toBe(false);
        expect(d.getCurrentOrder).not.toHaveBeenCalled();
    });

    it("rejects an order whose café has no chain mapping", async () => {
        const d = deps({
            findOrder: vi
                .fn()
                .mockResolvedValue({ ...order, chainCafeId: null }),
        });

        const result = await confirmPurchaseService("owner-1", "order-1", d);

        expect(result.ok).toBe(false);
        expect(d.signProof).not.toHaveBeenCalled();
    });
});
