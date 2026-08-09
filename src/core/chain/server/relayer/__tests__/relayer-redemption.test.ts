import { ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { describe, expect, it, vi } from "vitest";
import { abis } from "@/core/chain/abis";
import { type RelayerDeps, recoverStuckJobs, runRelayerOnce } from "../relayer";

const userWallet = `0x${"11".repeat(20)}` as `0x${string}`;
const addresses = {
    consumptionLog: `0x${"33".repeat(20)}` as `0x${string}`,
    punchVault: `0x${"44".repeat(20)}` as `0x${string}`,
};

const baseJob = (overrides = {}) =>
    ({
        id: "job",
        kind: "punch_redemption",
        orderId: null,
        redemptionRequestId: "request",
        payload: { userWallet, chainCafeId: 3, chainProductId: 7 },
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
    return {
        findJobsToRun: vi.fn().mockResolvedValue([job]),
        claimSubmittedJobs: vi.fn().mockResolvedValue([]),
        markJobSubmitted: vi.fn().mockResolvedValue(undefined),
        markJobConfirmed: vi.fn().mockResolvedValue(undefined),
        markJobRetry: vi.fn().mockResolvedValue(undefined),
        markJobFailed: vi.fn().mockResolvedValue(undefined),
        markJobPending: vi.fn().mockResolvedValue(undefined),
        hasRedemptionLedger: vi.fn().mockResolvedValue(false),
        wallet: {
            writeContract: vi.fn().mockResolvedValue(`0x${"55".repeat(32)}`),
        },
        pub: {
            waitForTransactionReceipt: vi
                .fn()
                .mockResolvedValue({ status: receipt }),
            getTransactionReceipt: vi.fn(),
            getLogs: vi.fn(),
            simulateContract: vi.fn(),
        },
        addresses,
        submitter: `0x${"66".repeat(20)}` as `0x${string}`,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
    } as unknown as RelayerDeps;
}

function revert(errorName: "InsufficientPunch" | "NotRedeemer") {
    const args =
        errorName === "InsufficientPunch"
            ? [userWallet, 3n]
            : [`0x${"22".repeat(20)}`];
    // biome-ignore lint/suspicious/noExplicitAny: viem's variadic ABI overload cannot infer dynamic test cases.
    const data = (encodeErrorResult as any)({
        abi: abis.punchVault,
        errorName,
        args,
    });
    return new ContractFunctionRevertedError({
        abi: abis.punchVault,
        data,
        functionName: "redeem",
    });
}

describe("punch redemption relayer", () => {
    it("sends PunchVault.redeem for punch_redemption jobs", async () => {
        const d = deps();
        await runRelayerOnce(d);
        expect(d.wallet.writeContract).toHaveBeenCalledWith({
            address: addresses.punchVault,
            abi: abis.punchVault,
            functionName: "redeem",
            args: [userWallet, 3n, 7n],
        });
    });

    it("skips send and confirms when redemption ledger already exists", async () => {
        const d = deps();
        d.hasRedemptionLedger = vi.fn().mockResolvedValue(true);
        await runRelayerOnce(d);
        expect(d.wallet.writeContract).not.toHaveBeenCalled();
        expect(d.markJobConfirmed).toHaveBeenCalledWith("job");
    });

    it("permanent vault revert marks job failed with parsed reason", async () => {
        const d = deps();
        d.wallet.writeContract = vi
            .fn()
            .mockRejectedValue(revert("InsufficientPunch"));
        await runRelayerOnce(d);
        expect(d.markJobFailed).toHaveBeenCalledWith(
            "job",
            "insufficient_punch",
            "insufficient_punch",
        );
    });

    it("replays reverted vault receipts and fails with parsed reason", async () => {
        const d = deps();
        d.pub.waitForTransactionReceipt = vi.fn().mockResolvedValue({
            status: "reverted",
            blockNumber: 12n,
        });
        d.pub.simulateContract = vi
            .fn()
            .mockRejectedValue(revert("InsufficientPunch"));
        await runRelayerOnce(d);
        expect(d.pub.simulateContract).toHaveBeenCalledWith({
            address: addresses.punchVault,
            abi: abis.punchVault,
            functionName: "redeem",
            args: [userWallet, 3n, 7n],
            account: d.submitter,
            blockNumber: 12n,
        });
        expect(d.markJobFailed).toHaveBeenCalledWith(
            "job",
            "insufficient_punch",
            "insufficient_punch",
        );
    });

    it("not_redeemer retries instead of failing permanently", async () => {
        const d = deps();
        d.wallet.writeContract = vi
            .fn()
            .mockRejectedValue(revert("NotRedeemer"));
        await runRelayerOnce(d);
        expect(d.markJobRetry).toHaveBeenCalled();
        expect(d.markJobFailed).not.toHaveBeenCalled();
    });

    it("recoverStuckJobs verifies existing receipt before any resend for redemption jobs", async () => {
        const d = deps(
            baseJob({ status: "submitted", txHash: `0x${"77".repeat(32)}` }),
        );
        d.claimSubmittedJobs = vi.fn().mockResolvedValue([
            baseJob({
                status: "submitted",
                txHash: `0x${"77".repeat(32)}`,
            }),
        ]);
        d.pub.getTransactionReceipt = vi
            .fn()
            .mockResolvedValue({ status: "success" });
        await recoverStuckJobs(d);
        expect(d.markJobConfirmed).toHaveBeenCalledWith("job");
        expect(d.wallet.writeContract).not.toHaveBeenCalled();
    });
});
