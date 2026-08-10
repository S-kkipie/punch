import {
    ContractFunctionRevertedError,
    encodeErrorResult,
    keccak256,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { abis } from "@/core/chain/abis";
import { type RelayerDeps, recoverStuckJobs, runRelayerOnce } from "../relayer";

const userWallet = `0x${"11".repeat(20)}` as `0x${string}`;
const signedTransaction = `0x${"ab".repeat(100)}` as `0x${string}`;
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
            writeContract: vi.fn(),
            prepareTransactionRequest: vi.fn().mockResolvedValue({}),
            signTransaction: vi.fn().mockResolvedValue(signedTransaction),
        },
        pub: {
            waitForTransactionReceipt: vi
                .fn()
                .mockResolvedValue({ status: receipt }),
            getTransactionReceipt: vi.fn(),
            sendRawTransaction: vi
                .fn()
                .mockResolvedValue(keccak256(signedTransaction)),
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
    it("persists the signed hash before broadcasting", async () => {
        const d = deps();
        d.pub.sendRawTransaction = vi
            .fn()
            .mockRejectedValue(new Error("broadcast down"));
        await runRelayerOnce(d);
        expect(d.markJobSubmitted).toHaveBeenCalledWith(
            "job",
            keccak256(signedTransaction),
            expect.any(Date),
            expect.objectContaining({ signedTransaction }),
        );
        expect(d.pub.sendRawTransaction).toHaveBeenCalledWith({
            serializedTransaction: signedTransaction,
        });
    });

    it("does not broadcast when submitted CAS loses", async () => {
        const d = deps();
        d.markJobSubmitted = vi.fn().mockResolvedValue(null);
        await runRelayerOnce(d);
        expect(d.markJobSubmitted).toHaveBeenCalled();
        expect(d.pub.sendRawTransaction).not.toHaveBeenCalled();
    });

    it("keeps an ambiguous rebroadcast recoverable while receipt is absent", async () => {
        const d = deps();
        d.pub.sendRawTransaction = vi
            .fn()
            .mockRejectedValue(new Error("nonce too low"));
        const missing = Object.assign(new Error("missing"), {
            name: "TransactionReceiptNotFoundError",
        });
        d.pub.getTransactionReceipt = vi.fn().mockRejectedValue(missing);
        await runRelayerOnce(d);
        expect(d.markJobPending).toHaveBeenCalledWith("job", expect.any(Date));
        expect(d.markJobFailed).not.toHaveBeenCalled();
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
        d.wallet.prepareTransactionRequest = vi
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
        d.wallet.prepareTransactionRequest = vi
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
                txHash: keccak256(signedTransaction),
                payload: {
                    userWallet,
                    chainCafeId: 3,
                    chainProductId: 7,
                    signedTransaction,
                },
            }),
        ]);
        d.pub.getTransactionReceipt = vi
            .fn()
            .mockResolvedValue({ status: "success" });
        await recoverStuckJobs(d);
        expect(d.markJobConfirmed).toHaveBeenCalledWith("job");
        expect(d.wallet.writeContract).not.toHaveBeenCalled();
        expect(d.pub.sendRawTransaction).not.toHaveBeenCalled();
    });

    it("does not resend a submitted redemption when its receipt is missing", async () => {
        const d = deps();
        const job = baseJob({
            status: "submitted",
            txHash: keccak256(signedTransaction),
            payload: {
                userWallet,
                chainCafeId: 3,
                chainProductId: 7,
                signedTransaction,
            },
        });
        d.claimSubmittedJobs = vi.fn().mockResolvedValue([job]);
        const missing = Object.assign(new Error("missing"), {
            name: "TransactionReceiptNotFoundError",
        });
        d.pub.getTransactionReceipt = vi.fn().mockRejectedValue(missing);
        await recoverStuckJobs(d);
        expect(d.pub.getTransactionReceipt).toHaveBeenCalledWith({
            hash: keccak256(signedTransaction),
        });
        expect(d.pub.sendRawTransaction).not.toHaveBeenCalled();
        expect(d.wallet.prepareTransactionRequest).not.toHaveBeenCalled();
        expect(d.markJobPending).toHaveBeenCalledWith("job", expect.any(Date));
    });
});
