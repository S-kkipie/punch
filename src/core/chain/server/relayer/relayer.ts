import "server-only";

import {
    type Address,
    type Hex,
    type PublicClient,
    parseEventLogs,
    type WalletClient,
} from "viem";
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
    claimSubmittedJobs,
    findJobsToRun,
    markJobConfirmed,
    markJobFailed,
    markJobPending,
    markJobRetry,
    markJobSubmitted,
    RELAYER_CLAIM_LEASE_MS,
} from "@/core/purchase/server/repository/purchase-repository";
import {
    type ParsedRevert,
    parseRevert,
    type RevertCode,
} from "./parse-revert";

const PERMANENT_CODES = new Set<RevertCode | "nonce_conflict">([
    "receipt_used",
    "daily_limit",
    "no_credits",
    "expired",
    "ticket_too_small",
    "product_not_eligible",
    "invalid_signature",
    "nonce_conflict",
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
    claimSubmittedJobs: (limit: number, leaseMs?: number) => Promise<Job[]>;
    markJobSubmitted: (
        id: string,
        txHash: Hex,
        nextRetryAt: Date,
    ) => Promise<unknown>;
    markJobConfirmed: (id: string) => Promise<unknown>;
    markJobRetry: (
        id: string,
        error: string,
        attempts: number,
        nextRetryAt: Date,
    ) => Promise<unknown>;
    markJobFailed: (
        id: string,
        error: string,
        failureReason: string,
    ) => Promise<unknown>;
    markJobPending: (id: string, nextRetryAt: Date) => Promise<unknown>;
    wallet: RelayerWallet;
    pub: {
        waitForTransactionReceipt: PublicClient["waitForTransactionReceipt"];
        getTransactionReceipt: PublicClient["getTransactionReceipt"];
        getLogs: PublicClient["getLogs"];
        simulateContract: (args: {
            address: Address;
            abi: typeof abis.consumptionLog;
            functionName: "recordConsumption";
            args: [ConsumptionProof, Hex, Hex];
            account: Address;
            blockNumber?: bigint;
        }) => Promise<unknown>;
    };
    addresses: ReturnType<typeof getAddresses>;
    submitter: Address;
    now: () => Date;
};

function defaultDeps(): RelayerDeps {
    const submitterAccount = deriveUserAccount(env.RELAYER_WALLET_INDEX);
    const wallet = createChainWalletClient(
        undefined,
        submitterAccount,
    ) as RelayerWallet;
    const repository = {
        findJobsToRun,
        claimSubmittedJobs,
        markJobSubmitted,
        markJobConfirmed,
        markJobRetry,
        markJobFailed,
        markJobPending,
    };
    return {
        ...repository,
        wallet,
        pub: createChainPublicClient(),
        addresses: getAddresses(),
        submitter: submitterAccount.address,
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
    blockNumber?: bigint,
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
            blockNumber,
        });
    } catch (error) {
        return error;
    }
    return new Error("transaction reverted");
}

async function hasRecordedProof(
    deps: RelayerDeps,
    submission: Submission,
): Promise<boolean> {
    const logs = await deps.pub.getLogs({
        address: deps.addresses.consumptionLog,
        fromBlock: 0n,
    });
    const events = parseEventLogs({
        abi: abis.consumptionLog,
        logs,
        eventName: "ConsumptionRecorded",
        strict: true,
    });
    return events.some((event) => {
        const args = event.args as {
            cafeId?: bigint;
            user?: Address;
            receiptHash?: Hex;
        };
        return (
            args.cafeId === submission.proof.cafeId &&
            args.user?.toLowerCase() === submission.proof.user.toLowerCase() &&
            args.receiptHash?.toLowerCase() ===
                submission.proof.receiptHash.toLowerCase()
        );
    });
}

async function handleFailure(
    deps: RelayerDeps,
    job: Job,
    error: unknown,
    submission?: Submission,
) {
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
        if (submission && (await hasRecordedProof(deps, submission))) {
            await confirm(deps, job);
            return;
        }
        await deps.markJobFailed(job.id, "nonce_conflict", "nonce_conflict");
        return;
    }
    if (invalidPayload || PERMANENT_CODES.has(code)) {
        await deps.markJobFailed(job.id, message, code);
        return;
    }
    const attempts = job.attempts + 1;
    if (attempts >= 3) {
        await deps.markJobFailed(job.id, message, code);
        return;
    }
    const nextRetryAt = new Date(deps.now().getTime() + 5_000 * 2 ** attempts);
    await deps.markJobRetry(job.id, message, attempts, nextRetryAt);
}

async function submitJob(deps: RelayerDeps, job: Job) {
    let hash: Hex;
    let submission: Submission | undefined;
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
        } as never)) as Hex;
    } catch (error) {
        await handleFailure(deps, job, error, submission);
        return;
    }

    // Database transition failures must escape rather than being mistaken for
    // chain failures. The outer drain continues other leased jobs and reports
    // the update failure to its caller.
    await deps.markJobSubmitted(
        job.id,
        hash,
        new Date(deps.now().getTime() + RELAYER_CLAIM_LEASE_MS),
    );
    try {
        const receipt = await deps.pub.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
            await confirm(deps, job);
        } else {
            await handleFailure(
                deps,
                job,
                await replaySubmissionError(
                    deps,
                    submission,
                    receipt.blockNumber,
                ),
                submission,
            );
        }
    } catch (error) {
        await handleFailure(deps, job, error, submission);
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
    const jobs = await deps.claimSubmittedJobs(10);
    for (const job of jobs) {
        if (!job.txHash) {
            await deps.markJobPending(job.id, deps.now());
            continue;
        }
        try {
            const receipt = await deps.pub.getTransactionReceipt({
                hash: job.txHash as Hex,
            });
            const submission = parseSubmission(job);
            if (receipt.status === "success") {
                await confirm(deps, job);
            } else {
                try {
                    await handleFailure(
                        deps,
                        job,
                        await replaySubmissionError(
                            deps,
                            submission,
                            receipt.blockNumber,
                        ),
                        submission,
                    );
                } catch (error) {
                    await handleFailure(deps, job, error, submission);
                }
            }
        } catch {
            // A missing receipt is not evidence of success. Requeue safely and
            // move the order back with the job so the two state machines agree.
            await deps.markJobPending(job.id, deps.now());
        }
    }
}
