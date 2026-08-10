import "server-only";

import {
    type Address,
    type Hex,
    keccak256,
    type PublicClient,
    type TransactionReceipt,
    TransactionReceiptNotFoundError,
    type WalletClient,
} from "viem";
import { type AddressMap, getAddresses } from "@/core/chain/addresses";
import {
    createChainPublicClient,
    createChainWalletClient,
} from "@/core/chain/chain";
import type { JobSideEffect } from "@/core/chain/server/relayer/job-repository";
import {
    claimSubmittedJobs,
    findJobsToRun,
    markJobConfirmed,
    markJobFailed,
    markJobPending,
    markJobRetry,
    markJobSigned,
    markJobSubmitted,
    RELAYER_CLAIM_LEASE_MS,
} from "@/core/chain/server/relayer/job-repository";
import { resolveSigner } from "@/core/chain/server/relayer/signers";
import {
    hasRecordedProof,
    parseSubmission,
    replaySubmissionError,
} from "./handlers/consumption-record";
import { handlerFor } from "./handlers/registry";
import type { JobContext, JobFailure } from "./handlers/types";
import {
    type ParsedRevert,
    parseRevert,
    type RevertCode,
} from "./parse-revert";

const PERMANENT_CODES = new Set<RevertCode | "nonce_conflict" | "superseded">([
    "receipt_used",
    "daily_limit",
    "no_credits",
    "expired",
    "ticket_too_small",
    "product_not_eligible",
    "invalid_signature",
    "not_draft",
    "not_published",
    "campaign_not_found",
    "campaign_expired",
    "max_vouchers_reached",
    "insufficient_budget",
    "insufficient_free_balance",
    "expiry_in_past",
    "zero_amount",
    "cafe_not_operational",
    "voucher_not_unlocked",
    "not_campaign_operator",
    "not_owner",
    "nonce_conflict",
    "superseded",
]);

type Job = Awaited<ReturnType<typeof findJobsToRun>>[number];
type RelayerWallet = WalletClient;

export type RelayerDeps = {
    findJobsToRun: (limit: number) => Promise<Job[]>;
    claimSubmittedJobs: (limit: number, leaseMs?: number) => Promise<Job[]>;
    markJobSubmitted: (
        id: string,
        txHash: Hex,
        nextRetryAt: Date,
        sideEffect?: JobSideEffect,
    ) => Promise<unknown>;
    markJobSigned?: (
        id: string,
        txHash: Hex,
        signedTx: Hex,
    ) => Promise<unknown>;
    markJobConfirmed: (
        id: string,
        sideEffect?: JobSideEffect,
    ) => Promise<unknown>;
    markJobRetry: (
        id: string,
        error: string,
        attempts: number,
        nextRetryAt: Date,
        sideEffect?: JobSideEffect,
    ) => Promise<unknown>;
    markJobFailed: (
        id: string,
        error: string,
        failureReason: string,
        sideEffect?: JobSideEffect,
    ) => Promise<unknown>;
    markJobPending: (
        id: string,
        nextRetryAt: Date,
        sideEffect?: JobSideEffect,
    ) => Promise<unknown>;
    wallet: RelayerWallet;
    pub: {
        waitForTransactionReceipt: PublicClient["waitForTransactionReceipt"];
        getTransactionReceipt: PublicClient["getTransactionReceipt"];
        getLogs: PublicClient["getLogs"];
        getBlock: PublicClient["getBlock"];
        simulateContract: (...args: never[]) => Promise<unknown>;

        readContract?: PublicClient["readContract"];
    };
    addresses: AddressMap;
    submitter: Address;
    now: () => Date;
    useHandlerSideEffects?: boolean;
    walletForSigner?: (
        signer: ReturnType<typeof resolveSigner>,
    ) => RelayerWallet;
};

function defaultDeps(): RelayerDeps {
    const submitterAccount = resolveSigner({ kind: "relayer" });
    const wallet = createChainWalletClient(
        undefined,
        submitterAccount,
    ) as RelayerWallet;
    return {
        findJobsToRun,
        claimSubmittedJobs,
        markJobSubmitted,
        markJobSigned,
        markJobConfirmed,
        markJobRetry,
        markJobFailed,
        markJobPending,
        wallet,
        pub: createChainPublicClient(),
        addresses: getAddresses(),
        submitter: submitterAccount.address,
        now: () => new Date(),
        useHandlerSideEffects: true,
        walletForSigner: (account) =>
            createChainWalletClient(undefined, account) as RelayerWallet,
    };
}

function context(deps: RelayerDeps): JobContext & { submitter: Address } {
    return {
        addresses: deps.addresses,
        pub: deps.pub as unknown as JobContext["pub"],
        now: deps.now,
        submitter: deps.submitter,
    };
}

function sanitizedFailure(parsed: ParsedRevert): string {
    return parsed.message;
}
function effect(deps: RelayerDeps, value: JobSideEffect | undefined) {
    return deps.useHandlerSideEffects ? value : undefined;
}
async function markConfirmed(
    deps: RelayerDeps,
    id: string,
    sideEffect?: JobSideEffect,
) {
    return sideEffect
        ? deps.markJobConfirmed(id, sideEffect)
        : deps.markJobConfirmed(id);
}
async function markSubmitted(
    deps: RelayerDeps,
    id: string,
    hash: Hex,
    next: Date,
    sideEffect?: JobSideEffect,
) {
    return sideEffect
        ? deps.markJobSubmitted(id, hash, next, sideEffect)
        : deps.markJobSubmitted(id, hash, next);
}
async function markFailed(
    deps: RelayerDeps,
    id: string,
    error: string,
    reason: string,
    sideEffect?: JobSideEffect,
) {
    return sideEffect
        ? deps.markJobFailed(id, error, reason, sideEffect)
        : deps.markJobFailed(id, error, reason);
}
async function markRetry(
    deps: RelayerDeps,
    id: string,
    error: string,
    attempts: number,
    next: Date,
    sideEffect?: JobSideEffect,
) {
    return sideEffect
        ? deps.markJobRetry(id, error, attempts, next, sideEffect)
        : deps.markJobRetry(id, error, attempts, next);
}
async function markPending(
    deps: RelayerDeps,
    id: string,
    next: Date,
    sideEffect?: JobSideEffect,
) {
    return sideEffect
        ? deps.markJobPending(id, next, sideEffect)
        : deps.markJobPending(id, next);
}
function isMissingReceiptError(error: unknown): boolean {
    return (
        error instanceof TransactionReceiptNotFoundError ||
        (error instanceof Error &&
            error.name === "TransactionReceiptNotFoundError")
    );
}

async function confirm(
    deps: RelayerDeps,
    job: Job,
    receipt?: TransactionReceipt,
) {
    const handler = handlerFor(job.kind ?? "consumption_record");
    await markConfirmed(
        deps,
        job.id,
        effect(deps, handler.onConfirmed?.(job, receipt as TransactionReceipt)),
    );
}

async function handleFailure(
    deps: RelayerDeps,
    job: Job,
    error: unknown,
    submission?: ReturnType<typeof parseSubmission>,
) {
    const handler = handlerFor(job.kind ?? "consumption_record");
    const parsed = parseRevert(error);
    const nonceTooLow =
        error instanceof Error && /nonce too low/i.test(error.message);
    const invalidPayload =
        error instanceof Error && error.message === "invalid payload";
    const invalidSignature =
        error instanceof Error && error.message === "invalid signature";
    const code: RevertCode | "superseded" = nonceTooLow
        ? "superseded"
        : invalidPayload
          ? "unknown"
          : invalidSignature
            ? "invalid_signature"
            : parsed.code;
    const failure: JobFailure = {
        code,
        message: nonceTooLow
            ? "superseded"
            : invalidPayload
              ? "invalid payload"
              : invalidSignature
                ? "invalid signature"
                : sanitizedFailure(parsed),
    };
    if (code !== "superseded" && handler.idempotentCodes?.has(code)) {
        if (
            code !== "nonce_used" ||
            (submission && (await hasRecordedProof(context(deps), submission)))
        ) {
            await confirm(deps, job);
            return;
        }
        const conflict: JobFailure = {
            code: "nonce_conflict",
            message: "nonce_conflict",
        };
        await markFailed(
            deps,
            job.id,
            conflict.message,
            conflict.code,
            effect(deps, handler.onFailed?.(job, conflict)),
        );
        return;
    }
    if (invalidPayload || PERMANENT_CODES.has(code)) {
        await markFailed(
            deps,
            job.id,
            failure.message,
            code,
            effect(deps, handler.onFailed?.(job, failure)),
        );
        return;
    }
    const attempts = job.attempts + 1;
    if (attempts >= 3) {
        await markFailed(
            deps,
            job.id,
            failure.message,
            code,
            effect(deps, handler.onFailed?.(job, failure)),
        );
        return;
    }
    const nextRetryAt = new Date(deps.now().getTime() + 5_000 * 2 ** attempts);
    await markRetry(
        deps,
        job.id,
        failure.message,
        attempts,
        nextRetryAt,
        effect(deps, handler.onRetry?.(job)),
    );
}

async function submitJob(deps: RelayerDeps, job: Job) {
    const handler = handlerFor(job.kind ?? "consumption_record");
    const ctx = context(deps);
    const preflight = await handler.preflight?.(job, ctx);
    if (preflight) {
        if (handler.idempotentCodes?.has(preflight.code as RevertCode)) {
            await confirm(deps, job);
            return;
        }
        if (PERMANENT_CODES.has(preflight.code as RevertCode)) {
            await markFailed(
                deps,
                job.id,
                preflight.message,
                preflight.code,
                effect(deps, handler.onFailed?.(job, preflight)),
            );
            return;
        }
        const attempts = job.attempts + 1;
        if (attempts >= 3) {
            await markFailed(
                deps,
                job.id,
                preflight.message,
                preflight.code,
                effect(deps, handler.onFailed?.(job, preflight)),
            );
            return;
        }
        await markRetry(
            deps,
            job.id,
            preflight.message,
            attempts,
            new Date(deps.now().getTime() + 5_000 * 2 ** attempts),
            effect(deps, handler.onRetry?.(job)),
        );
        return;
    }
    let submission: ReturnType<typeof parseSubmission> | undefined;
    let hash: Hex;
    let send: () => Promise<Hex>;
    try {
        if (job.kind === "consumption_record" || job.kind === undefined)
            submission = parseSubmission(job);
        const signer = resolveSigner(handler.signer(job));
        const wallet = deps.walletForSigner?.(signer) ?? deps.wallet;
        if (handler.idempotentOnChain === false && job.signedTx) {
            hash = (job.txHash as Hex) ?? keccak256(job.signedTx as Hex);
            send = () =>
                wallet.sendRawTransaction({
                    serializedTransaction: job.signedTx as Hex,
                });
        } else if (handler.idempotentOnChain === false) {
            const call = await handler.call(job, ctx);
            const request = await wallet.prepareTransactionRequest({
                ...call,
                args: call.args,
                account: signer,
            } as never);
            const signedTx = await wallet.signTransaction(request as never);
            hash = keccak256(signedTx as Hex);
            if (!deps.markJobSigned)
                throw new Error("missing markJobSigned dependency");
            await deps.markJobSigned(job.id, hash, signedTx as Hex);
            send = () =>
                wallet.sendRawTransaction({
                    serializedTransaction: signedTx as Hex,
                });
        } else {
            const call = await handler.call(job, ctx);
            hash = (await wallet.writeContract({
                ...call,
                args: call.args,
                account: signer,
            } as never)) as Hex;
            send = async () => hash;
        }
    } catch (error) {
        await handleFailure(deps, job, error, submission);
        return;
    }
    try {
        await send();
    } catch (error) {
        await handleFailure(deps, job, error, submission);
        return;
    }
    await markSubmitted(
        deps,
        job.id,
        hash,
        new Date(deps.now().getTime() + RELAYER_CLAIM_LEASE_MS),
        effect(deps, handler.onSubmitted?.(job, hash)),
    );
    try {
        const receipt = await deps.pub.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") await confirm(deps, job, receipt);
        else
            await handleFailure(
                deps,
                job,
                await replaySubmissionError(
                    ctx,
                    submission as ReturnType<typeof parseSubmission>,
                    receipt.blockNumber,
                ),
                submission,
            );
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
        const handler = handlerFor(job.kind ?? "consumption_record");
        if (!job.txHash) {
            await markPending(
                deps,
                job.id,
                deps.now(),
                effect(deps, handler.onPending?.(job)),
            );
            continue;
        }
        let submission: ReturnType<typeof parseSubmission> | undefined;
        try {
            if (job.kind === "consumption_record" || job.kind === undefined)
                submission = parseSubmission(job);
        } catch (error) {
            await handleFailure(deps, job, error);
            continue;
        }
        let receipt: Awaited<
            ReturnType<RelayerDeps["pub"]["getTransactionReceipt"]>
        >;
        try {
            receipt = await deps.pub.getTransactionReceipt({
                hash: job.txHash as Hex,
            });
        } catch (error) {
            if (isMissingReceiptError(error)) {
                await markPending(
                    deps,
                    job.id,
                    deps.now(),
                    effect(deps, handler.onPending?.(job)),
                );
                continue;
            }
            await handleFailure(deps, job, error, submission);
            continue;
        }
        if (receipt.status === "success") {
            await confirm(deps, job, receipt);
            continue;
        }
        try {
            await handleFailure(
                deps,
                job,
                submission
                    ? await replaySubmissionError(
                          context(deps),
                          submission,
                          receipt.blockNumber,
                      )
                    : new Error("transaction reverted"),
                submission,
            );
        } catch (error) {
            await handleFailure(deps, job, error, submission);
        }
    }
}
