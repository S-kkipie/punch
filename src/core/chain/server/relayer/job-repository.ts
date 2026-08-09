import "server-only";

import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import {
    type RelayerJobRow,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";

export const RELAYER_CLAIM_LEASE_MS = 60_000;

export type JobTransaction = Pick<typeof db, "select" | "insert" | "update">;
export type JobSideEffect = (
    tx: JobTransaction,
    job: RelayerJobRow,
) => Promise<void>;
export type RelayerJobKind = RelayerJobRow["kind"];

export async function enqueueJob(
    tx: JobTransaction,
    input: {
        kind: RelayerJobKind;
        idempotencyKey: string;
        payload: unknown;
        orderId?: string;
    },
): Promise<RelayerJobRow | null> {
    const [row] = await tx
        .insert(relayerJob)
        .values({
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
            payload: input.payload,
            orderId: input.orderId,
        })
        .onConflictDoNothing({ target: relayerJob.idempotencyKey })
        .returning();
    return row ?? null;
}

async function claimJobsByStatus(
    status: RelayerJobRow["status"],
    limit: number,
    leaseMs = RELAYER_CLAIM_LEASE_MS,
): Promise<RelayerJobRow[]> {
    if (limit <= 0) return [];
    return db.transaction(async (tx) => {
        const due = await tx
            .select()
            .from(relayerJob)
            .where(
                and(
                    eq(relayerJob.status, status),
                    lte(relayerJob.nextRetryAt, new Date()),
                ),
            )
            .limit(limit)
            .for("update", { skipLocked: true });
        if (due.length === 0) return [];
        const leaseUntil = new Date(Date.now() + leaseMs);
        return tx
            .update(relayerJob)
            .set({ nextRetryAt: leaseUntil })
            .where(
                inArray(
                    relayerJob.id,
                    due.map((job) => job.id),
                ),
            )
            .returning();
    });
}

export async function findJobsToRun(
    limit: number,
    leaseMs = RELAYER_CLAIM_LEASE_MS,
): Promise<RelayerJobRow[]> {
    return claimJobsByStatus("pending", limit, leaseMs);
}

export async function claimSubmittedJobs(
    limit: number,
    leaseMs = RELAYER_CLAIM_LEASE_MS,
): Promise<RelayerJobRow[]> {
    return claimJobsByStatus("submitted", limit, leaseMs);
}

export async function markJobSubmitted(
    id: string,
    txHash: string,
    nextRetryAt: Date,
    sideEffect?: JobSideEffect,
): Promise<RelayerJobRow | null> {
    return db.transaction(async (tx) => {
        const [job] = await tx
            .update(relayerJob)
            .set({ status: "submitted", txHash, lastError: null, nextRetryAt })
            .where(and(eq(relayerJob.id, id), eq(relayerJob.status, "pending")))
            .returning();
        if (!job) return null;
        if (sideEffect) await sideEffect(tx, job);
        return job;
    });
}

export async function markJobConfirmed(
    id: string,
    sideEffect?: JobSideEffect,
): Promise<RelayerJobRow | null> {
    return db.transaction(async (tx) => {
        const [job] = await tx
            .update(relayerJob)
            .set({ status: "confirmed", lastError: null })
            .where(
                and(
                    eq(relayerJob.id, id),
                    inArray(relayerJob.status, ["pending", "submitted"]),
                ),
            )
            .returning();
        if (job) {
            if (sideEffect) await sideEffect(tx, job);
            return job;
        }
        const [current] = await tx
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.id, id));
        if (!current) return null;
        if (current.status === "confirmed") {
            if (sideEffect) await sideEffect(tx, current);
            return null;
        }
        throw new Error("relayer confirmed order transition rejected");
    });
}

export async function markJobRetry(
    id: string,
    error: string,
    attempts: number,
    nextRetryAt: Date,
): Promise<unknown> {
    return db.transaction(async (tx) => {
        const [job] = await tx
            .update(relayerJob)
            .set({ status: "pending", lastError: error, attempts, nextRetryAt })
            .where(
                and(
                    eq(relayerJob.id, id),
                    inArray(relayerJob.status, ["pending", "submitted"]),
                ),
            )
            .returning();
        return job ?? null;
    });
}

export async function markJobFailed(
    id: string,
    error: string,
    failureReason: string,
    sideEffect?: JobSideEffect,
): Promise<unknown> {
    void failureReason;
    return db.transaction(async (tx) => {
        const [job] = await tx
            .update(relayerJob)
            .set({ status: "failed", lastError: error })
            .where(
                and(
                    eq(relayerJob.id, id),
                    inArray(relayerJob.status, ["pending", "submitted"]),
                ),
            )
            .returning();
        if (!job) return null;
        if (sideEffect) await sideEffect(tx, job);
        return job;
    });
}

export async function markJobPending(
    id: string,
    nextRetryAt: Date,
    sideEffect?: JobSideEffect,
): Promise<unknown> {
    return db.transaction(async (tx) => {
        const [job] = await tx
            .update(relayerJob)
            .set({ status: "pending", nextRetryAt, lastError: null })
            .where(
                and(eq(relayerJob.id, id), eq(relayerJob.status, "submitted")),
            )
            .returning();
        if (!job) return null;
        if (sideEffect) await sideEffect(tx, job);
        return job;
    });
}
