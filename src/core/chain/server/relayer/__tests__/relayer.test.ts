import {
    ContractFunctionRevertedError,
    encodeErrorResult,
    encodeEventTopics,
} from "viem";
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
const addresses = {
    consumptionLog: `0x${"33".repeat(20)}`,
} as { consumptionLog: `0x${string}` };
function recordedLog(
    overrides: {
        cafeId?: bigint;
        user?: `0x${string}`;
        receiptHash?: `0x${string}`;
    } = {},
) {
    return {
        address: addresses.consumptionLog,
        data: "0x",
        topics: encodeEventTopics({
            abi: abis.consumptionLog,
            eventName: "ConsumptionRecorded",
            args: {
                cafeId: overrides.cafeId ?? 1n,
                user: overrides.user ?? (proof.user as `0x${string}`),
                receiptHash:
                    overrides.receiptHash ??
                    (proof.receiptHash as `0x${string}`),
            },
        }),
    };
}

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
        claimSubmittedJobs: vi.fn().mockResolvedValue([]),
        markJobSubmitted: vi.fn().mockResolvedValue(undefined),
        markJobConfirmed: vi.fn().mockResolvedValue(undefined),
        markJobRetry: vi.fn().mockResolvedValue(undefined),
        markJobFailed: vi.fn().mockResolvedValue(undefined),
        markJobPending: vi.fn().mockResolvedValue(undefined),
        wallet: {
            writeContract: vi.fn().mockResolvedValue(`0x${"44".repeat(32)}`),
        },
        pub: {
            waitForTransactionReceipt: vi
                .fn()
                .mockResolvedValue({ status: receipt }),
            getTransactionReceipt: vi.fn(),
            getLogs: vi.fn().mockResolvedValue([recordedLog()]),
            simulateContract: vi.fn(),
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
            expect.any(Date),
        );
        expect(d.markJobConfirmed).toHaveBeenCalledWith("job");
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
        expect(d.markJobFailed).toHaveBeenCalledWith("job", code, code);
    });

    it("treats NonceUsed as confirmed when the proof event exists", async () => {
        const d = deps();
        d.wallet.writeContract = vi.fn().mockRejectedValue(revert("NonceUsed"));
        await runRelayerOnce(d);
        expect(d.markJobConfirmed).toHaveBeenCalledWith("job");
    });

    it("fails NonceUsed permanently when no matching proof event exists", async () => {
        const d = deps();
        d.wallet.writeContract = vi.fn().mockRejectedValue(revert("NonceUsed"));
        d.pub.getLogs = vi.fn().mockResolvedValue([]);

        await runRelayerOnce(d);

        expect(d.markJobConfirmed).not.toHaveBeenCalled();
        expect(d.markJobFailed).toHaveBeenCalledWith(
            "job",
            "nonce_conflict",
            "nonce_conflict",
        );
    });

    it("decodes a reverted receipt by replaying the submission at the mined block", async () => {
        const d = deps();
        d.pub.waitForTransactionReceipt = vi.fn().mockResolvedValue({
            status: "reverted",
            blockNumber: 77n,
        });
        d.pub.simulateContract = vi.fn().mockRejectedValue(revert("NoCredits"));

        await runRelayerOnce(d);

        expect(d.pub.simulateContract).toHaveBeenCalledWith({
            address: addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [
                {
                    cafeId: 1n,
                    user: proof.user,
                    productId: 2n,
                    amount: 1n,
                    receiptHash: proof.receiptHash,
                    nonce: 3n,
                    expiry: 9999999999n,
                },
                signature,
                signature,
            ],
            account: `0x${"55".repeat(20)}`,
            blockNumber: 77n,
        });
        expect(d.markJobFailed).toHaveBeenCalledWith(
            "job",
            "no_credits",
            "no_credits",
        );
    });

    it("decodes a reverted receipt by replaying the submission", async () => {
        const d = deps();
        d.pub.waitForTransactionReceipt = vi.fn().mockResolvedValue({
            status: "reverted",
        });
        d.pub.simulateContract = vi.fn().mockRejectedValue(revert("NoCredits"));

        await runRelayerOnce(d);

        expect(d.pub.simulateContract).toHaveBeenCalledWith({
            address: addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [
                {
                    cafeId: 1n,
                    user: proof.user,
                    productId: 2n,
                    amount: 1n,
                    receiptHash: proof.receiptHash,
                    nonce: 3n,
                    expiry: 9999999999n,
                },
                signature,
                signature,
            ],
            account: `0x${"55".repeat(20)}`,
        });
        expect(d.markJobFailed).toHaveBeenCalledWith(
            "job",
            "no_credits",
            "no_credits",
        );
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
                "unknown",
            );
        }
    });

    it("fails malformed payload and signature without submitting", async () => {
        const bad = deps(baseJob({ payload: { proof } }));
        await runRelayerOnce(bad);
        expect(bad.wallet.writeContract).not.toHaveBeenCalled();
        expect(bad.markJobFailed).toHaveBeenCalledWith(
            "job",
            "invalid signature",
            "invalid_signature",
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
            "unknown",
        );
    });

    it("recovers submitted jobs with missing receipt coherently", async () => {
        const d = deps(
            baseJob({ status: "submitted", txHash: `0x${"66".repeat(32)}` }),
        );
        d.findJobsToRun = vi.fn();
        d.claimSubmittedJobs = vi
            .fn()
            .mockResolvedValue([
                baseJob({ status: "submitted", txHash: null }),
            ]);
        await recoverStuckJobs(d);
        expect(d.markJobPending).toHaveBeenCalledWith("job", expect.any(Date));
    });

    it("replays reverted submitted jobs at the mined block", async () => {
        const d = deps(
            baseJob({ status: "submitted", txHash: `0x${"66".repeat(32)}` }),
        );
        d.findJobsToRun = vi.fn();
        d.claimSubmittedJobs = vi.fn().mockResolvedValue([
            baseJob({
                status: "submitted",
                txHash: `0x${"66".repeat(32)}`,
            }),
        ]);
        d.pub.getTransactionReceipt = vi.fn().mockResolvedValue({
            status: "reverted",
            blockNumber: 91n,
        });
        d.pub.simulateContract = vi.fn().mockRejectedValue(revert("NoCredits"));

        await recoverStuckJobs(d);

        expect(d.pub.simulateContract).toHaveBeenCalledWith({
            address: addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [
                {
                    cafeId: 1n,
                    user: proof.user,
                    productId: 2n,
                    amount: 1n,
                    receiptHash: proof.receiptHash,
                    nonce: 3n,
                    expiry: 9999999999n,
                },
                signature,
                signature,
            ],
            account: `0x${"55".repeat(20)}`,
            blockNumber: 91n,
        });
        expect(d.markJobFailed).toHaveBeenCalledWith(
            "job",
            "no_credits",
            "no_credits",
        );
    });

    it("replays reverted submitted jobs to keep failure reasons decodable", async () => {
        const d = deps(
            baseJob({ status: "submitted", txHash: `0x${"66".repeat(32)}` }),
        );
        d.findJobsToRun = vi.fn();
        d.claimSubmittedJobs = vi.fn().mockResolvedValue([
            baseJob({
                status: "submitted",
                txHash: `0x${"66".repeat(32)}`,
            }),
        ]);
        d.pub.getTransactionReceipt = vi.fn().mockResolvedValue({
            status: "reverted",
        });
        d.pub.simulateContract = vi.fn().mockRejectedValue(revert("NoCredits"));

        await recoverStuckJobs(d);

        expect(d.markJobFailed).toHaveBeenCalledWith(
            "job",
            "no_credits",
            "no_credits",
        );
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
