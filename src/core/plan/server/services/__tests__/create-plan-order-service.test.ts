import { describe, expect, it, vi } from "vitest";
import { createPlanOrderService } from "../create-plan-order-service";

const row = {
    id: "o1",
    cafeId: "c1",
    chainCafeId: 1,
    userId: "u1",
    kind: "plan" as const,
    price: 49_000_000n,
    signerAddress: "0x2222222222222222222222222222222222222222",
    signerWalletIndex: 3,
    status: "pending" as const,
    attempts: 0,
    nextRetryAt: new Date("2026-08-09T00:00:00Z"),
    txHash: null,
    lastError: null,
    failureReason: null,
    createdAt: new Date("2026-08-09T00:00:00Z"),
    updatedAt: new Date("2026-08-09T00:00:00Z"),
};

function deps(overrides = {}) {
    return {
        findCafeMembership: vi.fn().mockResolvedValue({
            chainCafeId: 1,
            walletAddress: "0x2222222222222222222222222222222222222222",
        }),
        readChainState: vi
            .fn()
            .mockResolvedValue({ planActive: false, unallocatedReserve: 0n }),
        isAuthorized: vi.fn().mockResolvedValue(true),
        ensureWallet: vi.fn().mockResolvedValue({
            walletIndex: 3,
            address: "0x2222222222222222222222222222222222222222",
        }),
        insertOrderIfIdle: vi.fn().mockResolvedValue({ created: true, row }),
        ...overrides,
    };
}

describe("createPlanOrderService", () => {
    it("creates a plan order for an authorized member", async () => {
        const d = deps();
        const result = await createPlanOrderService(
            "u1",
            { cafeId: "c1", kind: "plan" },
            d,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.priceSoles).toBe(49);
        expect(result.data.status).toBe("pending");
        expect(d.insertOrderIfIdle).toHaveBeenCalledWith(
            expect.objectContaining({
                cafeId: "c1",
                chainCafeId: 1,
                kind: "plan",
                price: 49_000_000n,
                signerWalletIndex: 3,
            }),
        );
    });

    it("charges the pack price for a pack", async () => {
        const d = deps({
            readChainState: vi.fn().mockResolvedValue({
                planActive: true,
                unallocatedReserve: 0n,
            }),
            insertOrderIfIdle: vi.fn().mockResolvedValue({
                created: true,
                row: { ...row, kind: "pack", price: 40_000_000n },
            }),
        });
        const result = await createPlanOrderService(
            "u1",
            { cafeId: "c1", kind: "pack" },
            d,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.priceSoles).toBe(40);
    });

    it("rejects a pack when the plan is not active", async () => {
        const result = await createPlanOrderService(
            "u1",
            { cafeId: "c1", kind: "pack" },
            deps(),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(422);
    });

    it("rejects a plan when the plan is already active", async () => {
        const d = deps({
            readChainState: vi.fn().mockResolvedValue({
                planActive: true,
                unallocatedReserve: 0n,
            }),
        });
        const result = await createPlanOrderService(
            "u1",
            { cafeId: "c1", kind: "plan" },
            d,
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(422);
    });

    it("rejects a non member", async () => {
        const d = deps({ findCafeMembership: vi.fn().mockResolvedValue(null) });
        const result = await createPlanOrderService(
            "u1",
            { cafeId: "c1", kind: "plan" },
            d,
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(404);
    });

    it("rejects a member whose wallet is not authorized on chain", async () => {
        const d = deps({ isAuthorized: vi.fn().mockResolvedValue(false) });
        const result = await createPlanOrderService(
            "u1",
            { cafeId: "c1", kind: "plan" },
            d,
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(403);
    });

    it("returns a conflict when a payment is already in flight", async () => {
        const d = deps({
            insertOrderIfIdle: vi
                .fn()
                .mockResolvedValue({ created: false, row }),
        });
        const result = await createPlanOrderService(
            "u1",
            { cafeId: "c1", kind: "plan" },
            d,
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(409);
    });
});
