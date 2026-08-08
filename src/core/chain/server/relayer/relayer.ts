import "server-only";

import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { env } from "@/config/env";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import {
    createChainPublicClient,
    createChainWalletClient,
} from "@/core/chain/chain";
import {
    type ConsumptionProof,
    deserializeProof,
} from "@/core/chain/server/proof/proof";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import {
    findJobsToRun,
    findSubmittedJobs,
    markJobConfirmed,
    markJobFailed,
    markJobPending,
    markJobRetry,
    markJobSubmitted,
    setOrderStatus,
} from "@/core/purchase/server/repository/purchase-repository";
import {
    type ParsedRevert,
    parseRevert,
    type RevertCode,
} from "./parse-revert";

const PERMANENT_CODES = new Set<RevertCode>([
    "receipt_used",
    "daily_limit",
    "no_credits",
    "expired",
    "ticket_too_small",
    "product_not_eligible",
    "invalid_signature",
]);

type Job = Awaited<ReturnType<typeof findJobsToRun>>[number];
type RelayerWallet = WalletClient;
type Submission = {
    proof: ConsumptionProof;
    cafeSignature: Hex;
    userSignature: Hex;
};

export type RelayerDeps = {
    findJobsToRun: (limit: number) => Promise<Job[]>;
    findSubmittedJobs: () => Promise<Job[]>;
    markJobSubmitted: (id: string, txHash: Hex) => Promise<unknown>;
    markJobConfirmed: (id: string) => Promise<unknown>;
    markJobRetry: (
        id: string,
        error: string,
        attempts: number,
        nextRetryAt: Date,
    ) => Promise<unknown>;
    markJobFailed: (id: string, error: string) => Promise<unknown>;
    markJobPending: (id: string, nextRetryAt: Date) => Promise<unknown>;
    setOrderStatus: (
        orderId: string,
        status: "queued" | "submitted" | "confirmed" | "failed",
        extra?: { txHash?: string; failureReason?: string },
    ) => Promise<unknown>;
    wallet: RelayerWallet;
    pub: {
        waitForTransactionReceipt: PublicClient["waitForTransactionReceipt"];
        getTransactionReceipt: PublicClient["getTransactionReceipt"];
        simulateContract: (args: {
            address: Address;
            abi: typeof abis.consumptionLog;
            functionName: "recordConsumption";
            args: [ConsumptionProof, Hex, Hex];
            account: Address;
        }) => Promise<unknown>;
    };
    addresses: ReturnType<typeof getAddresses>;
    submitter: Address;
    now: () => Date;
};

function defaultDeps(): RelayerDeps {
    const wallet = createChainWalletClient() as RelayerWallet;
    const submitter = deriveUserAccount(env.RELAYER_WALLET_INDEX).address;
    const repository = {
        findJobsToRun,
        findSubmittedJobs,
        markJobSubmitted,
        markJobConfirmed,
        markJobRetry,
        markJobFailed,
        markJobPending,
        setOrderStatus,
    };
    return {
        ...repository,
        wallet,
        pub: createChainPublicClient(),
        addresses: getAddresses(),
        submitter,
        now: () => new Date(),
    };
}

function isSignature(value: unknown): value is Hex {
    return typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);
}

function sanitizedFailure(parsed: ParsedRevert): string {
    return parsed.message;
}

async function confirm(deps: RelayerDeps, job: Job) {
    await deps.markJobConfirmed(job.id);
    await deps.setOrderStatus(job.orderId, "confirmed");
}

function parseSubmission(job: Job): Submission {
    if (!job.payload || typeof job.payload !== "object") {
        throw new Error("invalid payload");
    }
    const payload = job.payload as Record<string, unknown>;
    if (
        !isSignature(payload.cafeSignature) ||
        !isSignature(payload.userSignature)
    ) {
        throw new Error("invalid signature");
    }
    try {
        return {
            proof: deserializeProof(payload.proof),
            cafeSignature: payload.cafeSignature,
            userSignature: payload.userSignature,
        };
    } catch {
        throw new Error("invalid payload");
    }
}

async function replaySubmissionError(
    deps: RelayerDeps,
    submission: Submission,
): Promise<unknown> {
    try {
        await deps.pub.simulateContract({
            address: deps.addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [
                submission.proof,
                submission.cafeSignature,
                submission.userSignature,
            ],
            account: deps.submitter,
        });
    } catch (error) {
        return error;
    }
    return new Error("transaction reverted");
}

async function handleFailure(deps: RelayerDeps, job: Job, error: unknown) {
    const parsed = parseRevert(error);
    const invalidPayload =
        error instanceof Error && error.message === "invalid payload";
    const invalidSignature =
        error instanceof Error && error.message === "invalid signature";
    const code: RevertCode = invalidPayload
        ? "unknown"
        : invalidSignature
          ? "invalid_signature"
          : parsed.code;
    const message = invalidPayload
        ? "invalid payload"
        : invalidSignature
          ? "invalid signature"
          : sanitizedFailure(parsed);
    if (code === "nonce_used") {
        await confirm(deps, job);
        return;
    }
    if (invalidPayload || PERMANENT_CODES.has(code)) {
        await deps.markJobFailed(job.id, message);
        await deps.setOrderStatus(job.orderId, "failed", {
            failureReason: code,
        });
        return;
    }
    const attempts = job.attempts + 1;
    if (attempts >= 3) {
        await deps.markJobFailed(job.id, message);
        await deps.setOrderStatus(job.orderId, "failed", {
            failureReason: code,
        });
        return;
    }
    const nextRetryAt = new Date(deps.now().getTime() + 5_000 * 2 ** attempts);
    await deps.markJobRetry(job.id, message, attempts, nextRetryAt);
    await deps.setOrderStatus(job.orderId, "queued");
}

async function submitJob(deps: RelayerDeps, job: Job) {
    let hash: Hex;
    let submission: Submission;
    try {
        submission = parseSubmission(job);
        hash = (await deps.wallet.writeContract({
            address: deps.addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [
                submission.proof,
                submission.cafeSignature,
                submission.userSignature,
            ],
            account: deps.submitter,
        } as never)) as Hex;
    } catch (error) {
        await handleFailure(deps, job, error);
        return;
    }

    // Database transition failures must escape rather than being mistaken for
    // chain failures. The outer drain continues other leased jobs and reports
    // the update failure to its caller.
    await deps.markJobSubmitted(job.id, hash);
    await deps.setOrderStatus(job.orderId, "submitted", { txHash: hash });
    try {
        const receipt = await deps.pub.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
            await confirm(deps, job);
        } else {
            await handleFailure(
                deps,
                job,
                await replaySubmissionError(deps, submission),
            );
        }
    } catch (error) {
        await handleFailure(deps, job, error);
    }
}

export async function runRelayerOnce(
    deps: RelayerDeps = defaultDeps(),
): Promise<void> {
    const jobs = await deps.findJobsToRun(10);
    const failures: unknown[] = [];
    for (const job of jobs) {
        try {
            await submitJob(deps, job);
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0)
        throw new AggregateError(failures, "relayer state update failed");
}

export async function recoverStuckJobs(
    deps: RelayerDeps = defaultDeps(),
): Promise<void> {
    const jobs = await deps.findSubmittedJobs();
    for (const job of jobs) {
        if (!job.txHash) {
            await deps.markJobPending(job.id, deps.now());
            await deps.setOrderStatus(job.orderId, "queued");
            continue;
        }
        try {
            const receipt = await deps.pub.getTransactionReceipt({
                hash: job.txHash as Hex,
            });
            if (receipt.status === "success") {
                await confirm(deps, job);
            } else {
                try {
                    await handleFailure(
                        deps,
                        job,
                        await replaySubmissionError(deps, parseSubmission(job)),
                    );
                } catch (error) {
                    await handleFailure(deps, job, error);
                }
            }
        } catch {
            // A missing receipt is not evidence of success. Requeue safely and
            // move the order back with the job so the two state machines agree.
            await deps.markJobPending(job.id, deps.now());
            await deps.setOrderStatus(job.orderId, "queued");
        }
    }
}
