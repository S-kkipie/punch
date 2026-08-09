import { type Address, type Hex, parseEventLogs } from "viem";
import { abis } from "@/core/chain/abis";
import {
    type ConsumptionProof,
    deserializeProof,
} from "@/core/chain/server/proof/proof";
import { purchaseJobSideEffects } from "@/core/purchase/server/repository/purchase-repository";
import type { RelayerJobRow } from "@/server/drizzle/schemas/purchase-schema";
import type { JobCall, JobContext, JobHandler } from "./types";

export type Submission = {
    proof: ConsumptionProof;
    cafeSignature: Hex;
    userSignature: Hex;
};

function isSignature(value: unknown): value is Hex {
    return typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);
}

export function parseSubmission(job: RelayerJobRow): Submission {
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

export async function replaySubmissionError(
    ctx: JobContext,
    submission: Submission,
    blockNumber?: bigint,
): Promise<unknown> {
    try {
        await ctx.pub.simulateContract({
            address: ctx.addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [
                submission.proof,
                submission.cafeSignature,
                submission.userSignature,
            ],
            account: (ctx as JobContext & { submitter: Address }).submitter,
            blockNumber,
        } as never);
    } catch (error) {
        return error;
    }
    return new Error("transaction reverted");
}

export async function hasRecordedProof(
    ctx: JobContext,
    submission: Submission,
): Promise<boolean> {
    const logs = await ctx.pub.getLogs({
        address: ctx.addresses.consumptionLog,
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

export const consumptionRecordHandler: JobHandler = {
    kind: "consumption_record",
    signer: () => ({ kind: "relayer" }),
    async call(job, ctx): Promise<JobCall> {
        const submission = parseSubmission(job);
        return {
            address: ctx.addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [
                submission.proof,
                submission.cafeSignature,
                submission.userSignature,
            ],
        };
    },
    idempotentCodes: new Set(["nonce_used"]),
    onSubmitted: (_job, txHash) => purchaseJobSideEffects.submitted(txHash),
    onConfirmed: () => purchaseJobSideEffects.confirmed,
    onFailed: (_job, failure) => purchaseJobSideEffects.failed(failure.code),
    onRetry: () => purchaseJobSideEffects.retry,
    onPending: () => purchaseJobSideEffects.pending,
};
