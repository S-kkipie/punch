import { describe, expect, it, vi } from "vitest";
import { getPlanStatusService } from "../get-plan-status-service";

const membership = {
    chainCafeId: 1,
    walletAddress: "0x2222222222222222222222222222222222222222",
};

function deps(overrides = {}) {
    return {
        findCafeMembership: vi.fn().mockResolvedValue(membership),
        readChainState: vi.fn().mockResolvedValue({
            planActive: true,
            unallocatedReserve: 30_000_000n,
        }),
        readCredits: vi.fn().mockResolvedValue(100n),
        isAuthorized: vi.fn().mockResolvedValue(true),
        findInFlight: vi.fn().mockResolvedValue(null),
        findUnresolved: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
}

describe("getPlanStatusService", () => {
    it("reports plan, credits and reserve", async () => {
        const result = await getPlanStatusService("u1", "c1", deps());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data).toEqual({
            cafeId: "c1",
            planActive: true,
            credits: 100,
            unallocatedReserveSoles: 30,
            canPay: true,
            inFlightOrderId: null,
            needsReconciliation: false,
        });
    });

    it("reports zero credits when the projection has no row yet", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({ readCredits: vi.fn().mockResolvedValue(null) }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.credits).toBe(0);
    });

    it("says the user cannot pay when the wallet is not authorized on chain", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({ isAuthorized: vi.fn().mockResolvedValue(false) }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.canPay).toBe(false);
    });

    it("surfaces the order in flight", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({ findInFlight: vi.fn().mockResolvedValue({ id: "o1" }) }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.inFlightOrderId).toBe("o1");
    });

    it("reports when an unresolved payment needs reconciliation", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({ findUnresolved: vi.fn().mockResolvedValue({ id: "o2" }) }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.needsReconciliation).toBe(true);
    });

    it("reports no reconciliation when there is no unresolved payment", async () => {
        const result = await getPlanStatusService("u1", "c1", deps());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.needsReconciliation).toBe(false);
    });

    it("rejects a user who is not a member", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({ findCafeMembership: vi.fn().mockResolvedValue(null) }),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(404);
    });

    it("rejects a cafe that is not on chain yet", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({
                findCafeMembership: vi.fn().mockResolvedValue({
                    chainCafeId: null,
                    walletAddress: membership.walletAddress,
                }),
            }),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(422);
    });

    it("cannot pay without an assigned wallet", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({
                findCafeMembership: vi
                    .fn()
                    .mockResolvedValue({ chainCafeId: 1, walletAddress: null }),
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.canPay).toBe(false);
    });
});
