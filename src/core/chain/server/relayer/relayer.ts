import "server-only";

import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient, createChainWalletClient } from "@/core/chain/chain";
import { env } from "@/config/env";
import { deserializeProof } from "@/core/chain/server/proof/proof";
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
import { parseRevert, type ParsedRevert, type RevertCode } from "./parse-revert";

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
type Receipt = { status: "success" | "reverted" };
type RelayerWallet = WalletClient;

export type RelayerDeps = {
    findJobsToRun: (limit: number) => Promise<Job[]>;
    findSubmittedJobs: () => Promise<Job[]>;
    markJobSubmitted: (id: string, txHash: Hex) => Promise<unknown>;
    markJobConfirmed: (id: string) => Promise<unknown>;
    markJobRetry: (id: string, error: string, attempts: number, nextRetryAt: Date) => Promise<unknown>;
    markJobFailed: (id: string, error: string) => Promise<unknown>;
    markJobPending: (id: string, nextRetryAt: Date) => Promise<unknown>;
    setOrderStatus: (orderId: string, status: "submitted" | "confirmed" | "failed", extra?: { txHash?: string; failureReason?: string }) => Promise<unknown>;
    wallet: RelayerWallet;
    pub: Pick<PublicClient, "waitForTransactionReceipt" | "getTransactionReceipt">;
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

async function handleFailure(deps: RelayerDeps, job: Job, error: unknown) {
    const parsed = parseRevert(error);
    const invalidPayload = error instanceof Error && error.message === "invalid payload";
    if (invalidPayload) {
        await deps.markJobFailed(job.id, "invalid payload");
        await deps.setOrderStatus(job.orderId, "failed", { failureReason: "unknown" });
        return;
    }
    if (parsed.code === "nonce_used") {
        await confirm(deps, job);
        return;
    }
    if (PERMANENT_CODES.has(parsed.code)) {
        await deps.markJobFailed(job.id, sanitizedFailure(parsed));
        await deps.setOrderStatus(job.orderId, "failed", { failureReason: parsed.code });
        return;
    }
    const attempts = job.attempts + 1;
    if (attempts >= 3) {
        await deps.markJobFailed(job.id, sanitizedFailure(parsed));
        await deps.setOrderStatus(job.orderId, "failed", { failureReason: parsed.code });
        return;
    }
    const nextRetryAt = new Date(deps.now().getTime() + 5_000 * 2 ** attempts);
    await deps.markJobRetry(job.id, sanitizedFailure(parsed), attempts, nextRetryAt);
}

async function submitJob(deps: RelayerDeps, job: Job) {
    try {
        if (!job.payload || typeof job.payload !== "object") throw new Error("invalid payload");
        const payload = job.payload as Record<string, unknown>;
        if (!isSignature(payload.cafeSignature) || !isSignature(payload.userSignature)) {
            throw new Error("invalid payload");
        }
        let proof;
        try {
            proof = deserializeProof(payload.proof);
        } catch {
            throw new Error("invalid payload");
        }
        const hash = await deps.wallet.writeContract({
            address: deps.addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [proof, payload.cafeSignature, payload.userSignature],
            account: deps.submitter,
        } as never) as Hex;
        await deps.markJobSubmitted(job.id, hash);
        await deps.setOrderStatus(job.orderId, "submitted", { txHash: hash });
        const receipt = await deps.pub.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
            await confirm(deps, job);
        } else {
            await handleFailure(deps, job, new Error("transaction reverted"));
        }
    } catch (error) {
        await handleFailure(deps, job, error);
    }
}

export async function runRelayerOnce(deps: RelayerDeps = defaultDeps()): Promise<void> {
    const jobs = await deps.findJobsToRun(10);
    for (const job of jobs) await submitJob(deps, job);
}

export async function recoverStuckJobs(deps: RelayerDeps = defaultDeps()): Promise<void> {
    const jobs = await deps.findSubmittedJobs();
    for (const job of jobs) {
        if (!job.txHash) {
            await deps.markJobPending(job.id, deps.now());
            continue;
        }
        try {
            const receipt = await deps.pub.getTransactionReceipt({ hash: job.txHash as Hex });
            if (receipt.status === "success") {
                await confirm(deps, job);
            } else {
                await handleFailure(deps, job, new Error("transaction reverted"));
            }
        } catch {
            // A missing receipt is not evidence of success. Requeue safely.
            await deps.markJobPending(job.id, deps.now());
        }
    }
}
