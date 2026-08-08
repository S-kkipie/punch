import { ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { describe, expect, it, vi } from "vitest";
import { abis } from "@/core/chain/abis";
import { type RelayerDeps, recoverStuckJobs, runRelayerOnce } from "../relayer";

const proof = {
    cafeId: "1",
    user: `0x${"11".repeat(20)}`,
    productId: "2",
    amount: "1",
    receiptHash: `0x${"22".repeat(32)}`,
    nonce: "3",
    expiry: "9999999999",
};
const signature = `0x${"aa".repeat(65)}` as `0x${string}`;
const addresses = { consumptionLog: `0x${"33".repeat(20)}` } as never;
const baseJob = (overrides = {}) =>
    ({
        id: "job",
        orderId: "order",
        payload: { proof, cafeSignature: signature, userSignature: signature },
        attempts: 0,
        nextRetryAt: new Date(),
        status: "pending",
        txHash: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }) as never;

function deps(job = baseJob(), receipt: "success" | "reverted" = "success") {
    const d = {
        findJobsToRun: vi.fn().mockResolvedValue([job]),
        findSubmittedJobs: vi.fn().mockResolvedValue([]),
        markJobSubmitted: vi.fn().mockResolvedValue(undefined),
        markJobConfirmed: vi.fn().mockResolvedValue(undefined),
        markJobRetry: vi.fn().mockResolvedValue(undefined),
        markJobFailed: vi.fn().mockResolvedValue(undefined),
        markJobPending: vi.fn().mockResolvedValue(undefined),
        setOrderStatus: vi.fn().mockResolvedValue(undefined),
        wallet: {
            writeContract: vi.fn().mockResolvedValue(`0x${"44".repeat(32)}`),
        },
        pub: {
            waitForTransactionReceipt: vi
                .fn()
                .mockResolvedValue({ status: receipt }),
            getTransactionReceipt: vi.fn(),
        },
        addresses,
        submitter: `0x${"55".repeat(20)}`,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
    } as unknown as RelayerDeps;
    return d;
}

function revert(errorName: string) {
    const abi =
        errorName === "NoCredits" ? abis.planManager : abis.consumptionLog;
    const args =
        (
            {
                ReceiptUsed: [1n, `0x${"11".repeat(32)}`],
                DailyLimitReached: [1n, `0x${"11".repeat(20)}`],
                NoCredits: [1n],
                ProofExpired: [1n],
                TicketTooSmall: [1n],
                ProductNotEligible: [1n, 2n],
                NonceUsed: [1n, 2n],
            } as Record<string, unknown[]>
        )[errorName] ?? [];
    // biome-ignore lint/suspicious/noExplicitAny: viem's variadic ABI overload cannot infer dynamic test cases.
    const data = (encodeErrorResult as any)({ abi, errorName, args });
    return new ContractFunctionRevertedError({
        abi,
        data,
        functionName: "recordConsumption",
    });
}

describe("relayer loop", () => {
    it("submits and confirms both job and order", async () => {
        const d = deps();
        await runRelayerOnce(d);
        expect(d.markJobSubmitted).toHaveBeenCalledWith(
            "job",
            expect.any(String),
        );
        expect(d.setOrderStatus).toHaveBeenCalledWith(
            "order",
            "submitted",
            expect.anything(),
        );
        expect(d.markJobConfirmed).toHaveBeenCalledWith("job");
        expect(d.setOrderStatus).toHaveBeenCalledWith("order", "confirmed");
    });

    it.each([
        ["ReceiptUsed", "receipt_used"],
        ["DailyLimitReached", "daily_limit"],
        ["NoCredits", "no_credits"],
        ["ProofExpired", "expired"],
        ["TicketTooSmall", "ticket_too_small"],
        ["ProductNotEligible", "product_not_eligible"],
        ["InvalidUserSignature", "invalid_signature"],
    ] as const)("fails permanently with %s reason", async (name, code) => {
        const d = deps();
        d.wallet.writeContract = vi.fn().mockRejectedValue(revert(name));
        await runRelayerOnce(d);
        expect(d.markJobFailed).toHaveBeenCalledWith("job", code);
        expect(d.setOrderStatus).toHaveBeenCalledWith("order", "failed", {
            failureReason: code,
        });
    });

    it("treats NonceUsed as confirmed", async () => {
        const d = deps();
        d.wallet.writeContract = vi.fn().mockRejectedValue(revert("NonceUsed"));
        await runRelayerOnce(d);
        expect(d.markJobConfirmed).toHaveBeenCalledWith("job");
        expect(d.setOrderStatus).toHaveBeenCalledWith("order", "confirmed");
    });

    it.each([
        0, 1, 2,
    ])("retries unknown attempt %s with exponential backoff", async (attempts) => {
        const d = deps(baseJob({ attempts }));
        d.wallet.writeContract = vi
            .fn()
            .mockRejectedValue(new Error("network"));
        await runRelayerOnce(d);
        if (attempts < 2)
            expect(d.markJobRetry).toHaveBeenCalledWith(
                "job",
                "unknown chain or network error",
                attempts + 1,
                new Date(
                    Date.parse("2026-01-01T00:00:00.000Z") +
                        5_000 * 2 ** (attempts + 1),
                ),
            );
        else {
            expect(d.markJobFailed).toHaveBeenCalledWith(
                "job",
                "unknown chain or network error",
            );
            expect(d.setOrderStatus).toHaveBeenCalledWith("order", "failed", {
                failureReason: "unknown",
            });
        }
    });

    it("fails malformed payload and signature without submitting", async () => {
        const bad = deps(baseJob({ payload: { proof } }));
        await runRelayerOnce(bad);
        expect(bad.wallet.writeContract).not.toHaveBeenCalled();
        expect(bad.markJobFailed).toHaveBeenCalledWith(
            "job",
            "invalid signature",
        );
        const malformed = deps(
            baseJob({
                payload: {
                    cafeSignature: signature,
                    userSignature: signature,
                    proof: {},
                },
            }),
        );
        await runRelayerOnce(malformed);
        expect(malformed.markJobFailed).toHaveBeenCalledWith(
            "job",
            "invalid payload",
        );
    });

    it("recovers submitted jobs with missing receipt coherently", async () => {
        const d = deps(
            baseJob({ status: "submitted", txHash: `0x${"66".repeat(32)}` }),
        );
        d.findJobsToRun = vi.fn();
        d.findSubmittedJobs = vi
            .fn()
            .mockResolvedValue([
                baseJob({ status: "submitted", txHash: null }),
            ]);
        await recoverStuckJobs(d);
        expect(d.markJobPending).toHaveBeenCalledWith("job", expect.any(Date));
        expect(d.setOrderStatus).toHaveBeenCalledWith("order", "queued");
    });

    it("continues after a state update failure", async () => {
        const jobs = [
            baseJob({ id: "bad", orderId: "bad-order" }),
            baseJob({ id: "good", orderId: "good-order" }),
        ];
        const d = deps();
        d.findJobsToRun = vi.fn().mockResolvedValue(jobs);
        d.markJobSubmitted = vi
            .fn()
            .mockRejectedValueOnce(new Error("db down"))
            .mockResolvedValue(undefined);
        await expect(runRelayerOnce(d)).rejects.toThrow(
            "relayer state update failed",
        );
        expect(d.wallet.writeContract).toHaveBeenCalledTimes(2);
    });
});
