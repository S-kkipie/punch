import { describe, expect, it, vi } from "vitest";
import { runPlanRunnerOnce } from "../plan-runner";

const order = {
    id: "o1",
    cafeId: "c1",
    chainCafeId: 1,
    userId: "u1",
    kind: "plan" as const,
    price: 49_000_000n,
    signerAddress: "0x3333333333333333333333333333333333333333",
    signerWalletIndex: 3,
    status: "pending" as const,
    attempts: 0,
    nextRetryAt: new Date(),
    txHash: null,
    lastError: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

function deps(overrides = {}) {
    return {
        findOrdersToRun: vi.fn().mockResolvedValue([order]),
        claimSubmittedOrders: vi.fn().mockResolvedValue([]),
        markOrderExecuting: vi.fn().mockResolvedValue(order),
        extendSubmittedLease: vi.fn().mockResolvedValue(order),
        markOrderSubmitted: vi.fn().mockResolvedValue(order),
        markOrderConfirmed: vi.fn().mockResolvedValue(order),
        markOrderRetry: vi.fn().mockResolvedValue(order),
        markOrderFailed: vi.fn().mockResolvedValue(order),
        deriveAccount: vi
            .fn()
            .mockReturnValue({ address: order.signerAddress } as never),
        ensureGas: vi.fn().mockResolvedValue(undefined),
        ensureMpen: vi.fn().mockResolvedValue(undefined),
        readAllowance: vi.fn().mockResolvedValue(0n),
        approve: vi.fn().mockResolvedValue(undefined),
        simulate: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue("0xdead"),
        waitForReceipt: vi.fn().mockResolvedValue({ status: "success" }),
        now: () => new Date("2026-08-09T00:00:00Z"),
        ...overrides,
    };
}

describe("runPlanRunnerOnce", () => {
    it("funds, approves, executes and submits", async () => {
        const d = deps();
        await runPlanRunnerOnce(d);
        expect(d.ensureGas).toHaveBeenCalled();
        expect(d.ensureMpen).toHaveBeenCalledWith(
            expect.objectContaining({ price: 49_000_000n }),
        );
        expect(d.approve).toHaveBeenCalledWith(expect.anything(), 49_000_000n);
        expect(d.simulate).toHaveBeenCalledWith(expect.anything(), "plan", 1);
        expect(d.send).toHaveBeenCalledWith(expect.anything(), "plan", 1);
        expect(d.markOrderSubmitted).toHaveBeenCalledWith(
            "o1",
            "0xdead",
            expect.any(Date),
        );
    });

    it("skips approve when the allowance already covers the price", async () => {
        const d = deps({
            readAllowance: vi.fn().mockResolvedValue(60_000_000n),
        });
        await runPlanRunnerOnce(d);
        expect(d.approve).not.toHaveBeenCalled();
        expect(d.send).toHaveBeenCalled();
    });

    it("buys a pack when the order kind is pack", async () => {
        const d = deps({
            findOrdersToRun: vi
                .fn()
                .mockResolvedValue([
                    { ...order, kind: "pack", price: 40_000_000n },
                ]),
        });
        await runPlanRunnerOnce(d);
        expect(d.send).toHaveBeenCalledWith(expect.anything(), "pack", 1);
    });

    it("fails permanently on an authorization revert", async () => {
        const d = deps({
            simulate: vi
                .fn()
                .mockRejectedValue(new Error("NotAuthorizedForCafe(1, 0x0)")),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("NotAuthorizedForCafe"),
            "not_authorized",
        );
        expect(d.markOrderRetry).not.toHaveBeenCalled();
        expect(d.send).not.toHaveBeenCalled();
    });

    it("retries a transient failure with backoff", async () => {
        const d = deps({
            simulate: vi.fn().mockRejectedValue(new Error("fetch failed")),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderRetry).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("fetch failed"),
            1,
            expect.any(Date),
        );
    });

    it("gives up after the attempt cap", async () => {
        const d = deps({
            findOrdersToRun: vi
                .fn()
                .mockResolvedValue([{ ...order, attempts: 4 }]),
            simulate: vi.fn().mockRejectedValue(new Error("fetch failed")),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("fetch failed"),
            "max_attempts",
        );
    });

    it("fails permanently when funding is unavailable", async () => {
        const d = deps({
            ensureMpen: vi
                .fn()
                .mockRejectedValue(new Error("funding_unavailable")),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("funding_unavailable"),
            "funding_unavailable",
        );
    });

    it("does not retry after a send when recording the tx throws", async () => {
        const d = deps({
            findOrdersToRun: vi
                .fn()
                .mockResolvedValueOnce([order])
                .mockResolvedValueOnce([]),
            markOrderSubmitted: vi
                .fn()
                .mockRejectedValue(new Error("database unavailable")),
        });
        await runPlanRunnerOnce(d);
        await runPlanRunnerOnce(d);
        expect(d.markOrderRetry).not.toHaveBeenCalled();
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("database unavailable"),
            "needs_reconciliation",
        );
        expect(d.send).toHaveBeenCalledTimes(1);
    });

    it("does not retry after a send when recording the tx returns null", async () => {
        const d = deps({
            findOrdersToRun: vi
                .fn()
                .mockResolvedValueOnce([order])
                .mockResolvedValueOnce([]),
            markOrderSubmitted: vi.fn().mockResolvedValue(null),
        });
        await runPlanRunnerOnce(d);
        await runPlanRunnerOnce(d);
        expect(d.markOrderRetry).not.toHaveBeenCalled();
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining(
                "transaction submission could not be recorded",
            ),
            "needs_reconciliation",
        );
        expect(d.send).toHaveBeenCalledTimes(1);
    });

    it("does not send when another worker wins the executing claim", async () => {
        const d = deps({ markOrderExecuting: vi.fn().mockResolvedValue(null) });
        await runPlanRunnerOnce(d);
        expect(d.send).not.toHaveBeenCalled();
    });

    it("fails a submitted order without a transaction hash for reconciliation", async () => {
        const submitted = { ...order, status: "submitted" as const };
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([]),
            claimSubmittedOrders: vi.fn().mockResolvedValue([submitted]),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            "submitted without a recorded transaction hash",
            "needs_reconciliation",
        );
        expect(d.send).not.toHaveBeenCalled();
    });

    it("simulates authorization failures before sending", async () => {
        const d = deps({
            simulate: vi
                .fn()
                .mockRejectedValue(new Error("NotAuthorizedForCafe(1, 0x0)")),
        });
        await runPlanRunnerOnce(d);
        expect(d.send).not.toHaveBeenCalled();
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("NotAuthorizedForCafe"),
            "not_authorized",
        );
    });

    it("confirms a submitted order whose receipt succeeded", async () => {
        const submitted = {
            ...order,
            status: "submitted" as const,
            txHash: "0xdead",
        };
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([]),
            claimSubmittedOrders: vi.fn().mockResolvedValue([submitted]),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderConfirmed).toHaveBeenCalledWith("o1");
    });

    it("fails a submitted order whose receipt reverted", async () => {
        const submitted = {
            ...order,
            status: "submitted" as const,
            txHash: "0xdead",
        };
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([]),
            claimSubmittedOrders: vi.fn().mockResolvedValue([submitted]),
            waitForReceipt: vi.fn().mockResolvedValue({ status: "reverted" }),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("reverted"),
            "reverted",
        );
    });

    it("keeps a submitted order in the submitted lane while receipt is pending", async () => {
        const submitted = {
            ...order,
            status: "submitted" as const,
            txHash: "0xdead",
        };
        const markOrderPending = vi.fn();
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([]),
            claimSubmittedOrders: vi.fn().mockResolvedValue([submitted]),
            waitForReceipt: vi
                .fn()
                .mockRejectedValue(new Error("receipt not found")),
            markOrderPending,
        });
        await runPlanRunnerOnce(d);
        expect(d.extendSubmittedLease).toHaveBeenCalledWith(
            "o1",
            expect.any(Date),
        );
        expect(markOrderPending).not.toHaveBeenCalled();
        expect(d.send).not.toHaveBeenCalled();
    });

    it("waits again after a receipt timeout without sending again", async () => {
        const submitted = {
            ...order,
            status: "submitted" as const,
            txHash: "0xdead",
        };
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([]),
            claimSubmittedOrders: vi.fn().mockResolvedValue([submitted]),
            waitForReceipt: vi
                .fn()
                .mockRejectedValue(new Error("receipt not found")),
        });
        await runPlanRunnerOnce(d);
        await runPlanRunnerOnce(d);
        expect(d.waitForReceipt).toHaveBeenCalledTimes(2);
        expect(d.extendSubmittedLease).toHaveBeenCalledTimes(2);
        expect(d.send).not.toHaveBeenCalled();
    });
});
