import "server-only";

import { eq } from "drizzle-orm";
import {
    type Address,
    encodeFunctionData,
    type Hex,
    keccak256,
    type PublicClient,
    type TransactionReceipt,
    TransactionReceiptNotFoundError,
    type WalletClient,
} from "viem";
import { abis } from "@/core/chain/abis";
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
import { db } from "@/server/drizzle/db";
import { consumerTransaction } from "@/server/drizzle/schemas/consumption-schema";
import {
    hasRecordedProof,
    parseSubmission,
    replaySubmissionError,
} from "./handlers/consumption-record";
import { handlerFor } from "./handlers/registry";
import type { JobContext, JobFailure, JobHandler } from "./handlers/types";
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
    "insufficient_punch",
    "host_not_operational",
    "reward_not_eligible",
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

function isConsumptionJobKind(kind: Job["kind"] | undefined): boolean {
    return (
        kind === "consumption" ||
        kind === "consumption_record" ||
        kind === undefined
    );
}

export type RelayerDeps = {
    findJobsToRun: (limit: number) => Promise<Job[]>;
    claimSubmittedJobs: (limit: number, leaseMs?: number) => Promise<Job[]>;
    markJobSubmitted: (
        id: string,
        txHash: Hex,
        nextRetryAt: Date,
        sideEffect?: JobSideEffect | { signedTransaction: string },
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
    hasRedemptionLedger?: (requestId: string) => Promise<boolean>;
    wallet: RelayerWallet;
    pub: {
        sendRawTransaction: PublicClient["sendRawTransaction"];
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
        hasRedemptionLedger: async (requestId: string) => {
            const [row] = await db
                .select({ id: consumerTransaction.id })
                .from(consumerTransaction)
                .where(
                    eq(
                        consumerTransaction.idempotencyKey,
                        `chain_redemption:${requestId}`,
                    ),
                );
            return !!row;
        },
        wallet,
        pub: createChainPublicClient() as unknown as RelayerDeps["pub"],
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

function handlerForJob(job: Job): JobHandler | null {
    return job.kind === "punch_redemption"
        ? null
        : handlerFor(job.kind ?? "consumption_record");
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
    const handler = handlerForJob(job);
    await markConfirmed(
        deps,
        job.id,
        effect(
            deps,
            handler?.onConfirmed?.(job, receipt as TransactionReceipt),
        ),
    );
}

async function handleFailure(
    deps: RelayerDeps,
    job: Job,
    error: unknown,
    submission?: ReturnType<typeof parseSubmission>,
) {
    const handler = handlerForJob(job);
    if (!handler) {
        const parsed = parseRevert(error);
        const message = parsed.message;
        if (PERMANENT_CODES.has(parsed.code))
            await deps.markJobFailed(job.id, message, parsed.code);
        else
            await deps.markJobRetry(
                job.id,
                message,
                job.attempts + 1,
                new Date(deps.now().getTime() + 5000 * 2 ** (job.attempts + 1)),
            );
        return;
    }
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
    if (code !== "superseded" && handler?.idempotentCodes?.has(code)) {
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
            effect(deps, handler?.onFailed?.(job, conflict)),
        );
        return;
    }
    if (invalidPayload || PERMANENT_CODES.has(code)) {
        await markFailed(
            deps,
            job.id,
            failure.message,
            code,
            effect(deps, handler?.onFailed?.(job, failure)),
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
            effect(deps, handler?.onFailed?.(job, failure)),
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
        effect(deps, handler?.onRetry?.(job)),
    );
}

type RedemptionSubmission = {
    user: Address;
    cafeId: bigint;
    productId: bigint;
};
function parseRedemptionSubmission(job: Job): RedemptionSubmission {
    if (!job.payload || typeof job.payload !== "object")
        throw new Error("invalid payload");
    const payload = job.payload as Record<string, unknown>;
    if (
        typeof payload.userWallet !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(payload.userWallet) ||
        typeof payload.chainCafeId !== "number" ||
        !Number.isInteger(payload.chainCafeId) ||
        typeof payload.chainProductId !== "number" ||
        !Number.isInteger(payload.chainProductId)
    )
        throw new Error("invalid payload");
    return {
        user: payload.userWallet as Address,
        cafeId: BigInt(payload.chainCafeId),
        productId: BigInt(payload.chainProductId),
    };
}
async function hasRedemptionLedger(deps: RelayerDeps, requestId: string) {
    if (!deps.hasRedemptionLedger)
        throw new Error("redemption ledger guard unavailable");
    return deps.hasRedemptionLedger(requestId);
}
async function replayRedemptionError(
    deps: RelayerDeps,
    submission: RedemptionSubmission,
    blockNumber?: bigint,
): Promise<unknown> {
    try {
        await deps.pub.simulateContract({
            address: deps.addresses.punchVault,
            abi: abis.punchVault,
            functionName: "redeem",
            args: [submission.user, submission.cafeId, submission.productId],
            account: deps.submitter,
            blockNumber,
        } as never);
    } catch (error) {
        return error;
    }
    return new Error("transaction reverted");
}
function isAmbiguousRedemptionBroadcastError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /already known|already-known|nonce too low|nonce has already been used|replacement transaction underpriced|known transaction/i.test(
        message,
    );
}
function getPersistedSignedTransaction(job: Job): Hex | undefined {
    if (!job.payload || typeof job.payload !== "object") return undefined;
    const value = (job.payload as Record<string, unknown>).signedTransaction;
    return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)
        ? (value as Hex)
        : undefined;
}
async function submitRedemptionJob(deps: RelayerDeps, job: Job) {
    if (!job.redemptionRequestId) {
        await deps.markJobFailed(job.id, "invalid payload", "unknown");
        return;
    }
    if (await hasRedemptionLedger(deps, job.redemptionRequestId)) {
        await confirm(deps, job);
        return;
    }
    let submission: RedemptionSubmission;
    let signedTransaction = getPersistedSignedTransaction(job);
    let hash: Hex;
    try {
        submission = parseRedemptionSubmission(job);
        if (!signedTransaction) {
            const data = encodeFunctionData({
                abi: abis.punchVault,
                functionName: "redeem",
                args: [
                    submission.user,
                    submission.cafeId,
                    submission.productId,
                ],
            });
            const request = await deps.wallet.prepareTransactionRequest({
                account: deps.submitter,
                to: deps.addresses.punchVault,
                data,
            } as never);
            signedTransaction = (await deps.wallet.signTransaction(
                request as never,
            )) as Hex;
        }
        hash = keccak256(signedTransaction);
    } catch (error) {
        await handleFailure(deps, job, error);
        return;
    }
    if (!job.signedTx && deps.markJobSigned) {
        const signed = await deps.markJobSigned(
            job.id,
            hash,
            signedTransaction,
        );
        if (signed === null) return;
    }
    const persisted = await deps.markJobSubmitted(
        job.id,
        hash,
        new Date(deps.now().getTime() + RELAYER_CLAIM_LEASE_MS),
        { signedTransaction },
    );
    if (persisted === null) return;
    try {
        await deps.pub.sendRawTransaction({
            serializedTransaction: signedTransaction,
        });
        const receipt = await deps.pub.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") await confirm(deps, job);
        else
            await handleFailure(
                deps,
                job,
                await replayRedemptionError(
                    deps,
                    submission,
                    receipt.blockNumber,
                ),
            );
    } catch (error) {
        if (isAmbiguousRedemptionBroadcastError(error)) {
            try {
                const receipt = await deps.pub.getTransactionReceipt({ hash });
                if (receipt.status === "success") await confirm(deps, job);
                else
                    await handleFailure(
                        deps,
                        job,
                        await replayRedemptionError(
                            deps,
                            submission,
                            receipt.blockNumber,
                        ),
                    );
            } catch {
                await markPending(deps, job.id, deps.now());
            }
            return;
        }
        await handleFailure(deps, job, error);
    }
}
async function submitJob(deps: RelayerDeps, job: Job) {
    if (job.kind === "punch_redemption") return submitRedemptionJob(deps, job);
    const handler = handlerForJob(job);
    if (!handler)
        throw new Error("unsupported relayer job kind punch_redemption");
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
                effect(deps, handler?.onFailed?.(job, preflight)),
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
                effect(deps, handler?.onFailed?.(job, preflight)),
            );
            return;
        }
        await markRetry(
            deps,
            job.id,
            preflight.message,
            attempts,
            new Date(deps.now().getTime() + 5_000 * 2 ** attempts),
            effect(deps, handler?.onRetry?.(job)),
        );
        return;
    }
    let submission: ReturnType<typeof parseSubmission> | undefined;
    let hash: Hex;
    let send: () => Promise<Hex>;
    try {
        if (isConsumptionJobKind(job.kind)) submission = parseSubmission(job);
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
                to: call.address,
                data: encodeFunctionData({
                    abi: call.abi,
                    functionName: call.functionName,
                    args: call.args,
                } as never),
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
        effect(deps, handler?.onSubmitted?.(job, hash)),
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
        const handler = handlerForJob(job);
        if (!job.txHash) {
            await markPending(
                deps,
                job.id,
                deps.now(),
                effect(deps, handler?.onPending?.(job)),
            );
            continue;
        }
        if (job.kind === "punch_redemption") {
            if (
                job.redemptionRequestId &&
                (await hasRedemptionLedger(deps, job.redemptionRequestId))
            ) {
                await confirm(deps, job);
                continue;
            }
            let redemption: RedemptionSubmission;
            try {
                redemption = parseRedemptionSubmission(job);
            } catch (error) {
                await handleFailure(deps, job, error);
                continue;
            }
            let redemptionReceipt: Awaited<
                ReturnType<RelayerDeps["pub"]["getTransactionReceipt"]>
            >;
            try {
                redemptionReceipt = await deps.pub.getTransactionReceipt({
                    hash: job.txHash as Hex,
                });
            } catch (error) {
                if (isMissingReceiptError(error)) {
                    await markPending(deps, job.id, deps.now());
                    continue;
                }
                await handleFailure(deps, job, error);
                continue;
            }
            if (redemptionReceipt.status === "success") {
                await confirm(deps, job, redemptionReceipt);
                continue;
            }
            await handleFailure(
                deps,
                job,
                await replayRedemptionError(
                    deps,
                    redemption,
                    redemptionReceipt.blockNumber,
                ),
            );
            continue;
        }
        let submission: ReturnType<typeof parseSubmission> | undefined;
        try {
            if (isConsumptionJobKind(job.kind))
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
                    effect(deps, handler?.onPending?.(job)),
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
