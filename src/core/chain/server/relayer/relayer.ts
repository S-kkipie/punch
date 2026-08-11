import "server-only";

import { getAddresses } from "@/core/chain/addresses";
import { abis } from "@/core/chain/abis";
import { createChainPublicClient, createChainWalletClient } from "@/core/chain/chain";
import { env } from "@/config/env";
import { deserializeProof } from "@/core/chain/server/proof/proof";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import {
    findJobsToRun,
    findSubmittedJobs,
    markJobConfirmed,
    markJobFailed,
    markJobRetry,
    markJobSubmitted,
    setOrderStatus,
} from "@/core/purchase/server/repository/purchase-repository";
import type { RelayerJobRow } from "@/server/drizzle/schemas/purchase-schema";
import { parseRevert, type ParsedRevert } from "./parse-revert";

const PERMANENT_CODES = new Set([
    "receipt_used", "daily_limit", "no_credits", "expired", "ticket_too_small", "product_not_eligible", "invalid_signature",
]);

type TxHash = `0x${string}`;
type RelayerWallet = ReturnType<typeof createChainWalletClient>;
type RelayerPublic = ReturnType<typeof createChainPublicClient>;

export type RelayerDeps = {
    findJobsToRun: (limit: number, leaseMs?: number) => Promise<RelayerJobRow[]>;
    findSubmittedJobs: () => Promise<RelayerJobRow[]>;
    markJobSubmitted: (id: string, txHash: string) => Promise<unknown>;
    markJobConfirmed: (id: string) => Promise<unknown>;
    markJobRetry: (id: string, error: string, attempts: number, nextRetryAt?: Date) => Promise<unknown>;
    markJobFailed: (id: string, error: string) => Promise<unknown>;
    setOrderStatus: (orderId: string, status: "submitted" | "confirmed" | "failed", extra?: { txHash?: string; failureReason?: string }) => Promise<unknown>;
    wallet: RelayerWallet;
    pub: RelayerPublic;
    addresses: ReturnType<typeof getAddresses>;
    submitter: ReturnType<typeof deriveUserAccount>;
};

function defaultDeps(): RelayerDeps {
    return {
        findJobsToRun,
        findSubmittedJobs,
        markJobSubmitted,
        markJobConfirmed,
        markJobRetry,
        markJobFailed,
        setOrderStatus,
        wallet: createChainWalletClient(),
        pub: createChainPublicClient(),
        addresses: getAddresses(),
        submitter: deriveUserAccount(env.RELAYER_WALLET_INDEX),
    };
}

function failureMessage(parsed: ParsedRevert): string {
    return parsed.code === "unknown" ? "unknown chain or network failure" : parsed.message;
}

async function handleFailure(deps: RelayerDeps, job: RelayerJobRow, error: unknown): Promise<void> {
    const parsed = parseRevert(error);
    const attempts = job.attempts + 1;
    if (parsed.code === "nonce_used") {
        await deps.markJobConfirmed(job.id);
        return;
    }
    if (PERMANENT_CODES.has(parsed.code) || attempts >= 3) {
        const reason = parsed.code === "unknown" ? "unknown" : parsed.code;
        await deps.markJobFailed(job.id, reason);
        return;
    }
    const retryAt = new Date(Date.now() + 5_000 * 2 ** attempts);
    await deps.markJobRetry(job.id, failureMessage(parsed), attempts, retryAt);
}

function payloadFor(job: RelayerJobRow) {
    if (job.payload === null || typeof job.payload !== "object") throw new Error("invalid payload");
    const payload = job.payload as Record<string, unknown>;
    if (typeof payload.cafeSignature !== "string" || typeof payload.userSignature !== "string") throw new Error("invalid payload");
    return {
        proof: deserializeProof(payload.proof),
        cafeSignature: payload.cafeSignature as `0x${string}`,
        userSignature: payload.userSignature as `0x${string}`,
    };
}

async function submitJob(deps: RelayerDeps, job: RelayerJobRow): Promise<void> {
    let payload: ReturnType<typeof payloadFor>;
    try {
        payload = payloadFor(job);
    } catch {
        await deps.markJobFailed(job.id, "invalid_payload");
        return;
    }
    try {
        const hash = await deps.wallet.writeContract({
            address: deps.addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [payload.proof, payload.cafeSignature, payload.userSignature],
            account: deps.submitter,
        } as never) as TxHash;
        await deps.markJobSubmitted(job.id, hash);
        await deps.setOrderStatus(job.orderId, "submitted", { txHash: hash });
        const receipt = await deps.pub.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
            await deps.markJobConfirmed(job.id);
        } else {
            await handleFailure(deps, job, new Error("transaction reverted"));
        }
    } catch (error) {
        await handleFailure(deps, job, error);
    }
}

export async function runRelayerOnce(deps: RelayerDeps = defaultDeps()): Promise<void> {
    const jobs = await deps.findJobsToRun(10);
    for (const job of jobs) {
        try { await submitJob(deps, job); } catch { /* recovery pass handles submitted jobs after partial DB failures */ }
    }
}

export async function recoverStuckJobs(deps: RelayerDeps = defaultDeps()): Promise<void> {
    const jobs = await deps.findSubmittedJobs();
    for (const job of jobs) {
        if (!job.txHash) {
            await deps.markJobRetry(job.id, "unknown transaction", job.attempts, new Date());
            continue;
        }
        try {
            const receipt = await deps.pub.getTransactionReceipt({ hash: job.txHash as TxHash });
            if (receipt.status === "success") await deps.markJobConfirmed(job.id);
            else await deps.markJobFailed(job.id, "unknown");
        } catch {
            // A missing receipt is not confirmation. Requeue safely; NonceUsed is idempotent on resend.
            await deps.markJobRetry(job.id, "unknown transaction", job.attempts, new Date());
        }
    }
}

export { handleFailure };
