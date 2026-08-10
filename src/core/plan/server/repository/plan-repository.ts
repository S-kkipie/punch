import "server-only";

import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type {
    PlanFailureReason,
    PlanOrderKind,
} from "@/core/plan/domain/types";
import { db } from "@/server/drizzle/db";
import {
    type PlanOrderRow,
    planOrder,
} from "@/server/drizzle/schemas/plan-schema";

export const PLAN_CLAIM_LEASE_MS = 60_000;
const IN_FLIGHT = ["pending", "submitted"] as const;

export type InsertPlanOrder = {
    id: string;
    cafeId: string;
    chainCafeId: number;
    userId: string;
    kind: PlanOrderKind;
    price: bigint;
    signerAddress: string;
    signerWalletIndex: number;
};

export async function findInFlightByCafe(
    cafeId: string,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .select()
        .from(planOrder)
        .where(
            and(
                eq(planOrder.cafeId, cafeId),
                inArray(planOrder.status, [...IN_FLIGHT]),
            ),
        )
        .limit(1);
    return row ?? null;
}

/** An order whose on-chain outcome is unknown blocks new payments until a human resolves it. */
export async function findUnresolvedByCafe(
    cafeId: string,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .select()
        .from(planOrder)
        .where(
            and(
                eq(planOrder.cafeId, cafeId),
                eq(planOrder.status, "failed"),
                eq(planOrder.failureReason, "needs_reconciliation"),
            ),
        )
        .limit(1);
    return row ?? null;
}

/**
 * Inserts unless the cafe already has a payment in flight. The partial unique
 * index is the real guard: two concurrent requests both reach the insert and
 * exactly one wins.
 */
export async function insertOrderIfIdle(
    input: InsertPlanOrder,
): Promise<{ created: boolean; row: PlanOrderRow }> {
    const [inserted] = await db
        .insert(planOrder)
        .values({
            ...input,
            signerAddress: input.signerAddress.toLowerCase(),
            status: "pending",
        })
        .onConflictDoNothing({
            target: planOrder.cafeId,
            where: sql`status in ('pending', 'submitted')`,
        })
        .returning();
    if (inserted) return { created: true, row: inserted };
    const existing = await findInFlightByCafe(input.cafeId);
    if (!existing)
        throw new Error("plan order insert lost a race with no winner");
    return { created: false, row: existing };
}

export async function findOrder(id: string): Promise<PlanOrderRow | null> {
    const [row] = await db
        .select()
        .from(planOrder)
        .where(eq(planOrder.id, id))
        .limit(1);
    return row ?? null;
}

export async function listOrdersByCafe(
    cafeId: string,
    limit = 50,
): Promise<PlanOrderRow[]> {
    return db
        .select()
        .from(planOrder)
        .where(eq(planOrder.cafeId, cafeId))
        .orderBy(desc(planOrder.createdAt))
        .limit(limit);
}

async function claimByStatus(
    status: PlanOrderRow["status"],
    limit: number,
    leaseMs = PLAN_CLAIM_LEASE_MS,
): Promise<PlanOrderRow[]> {
    if (limit <= 0) return [];
    return db.transaction(async (tx) => {
        const due = await tx
            .select()
            .from(planOrder)
            .where(
                and(
                    eq(planOrder.status, status),
                    lte(planOrder.nextRetryAt, new Date()),
                ),
            )
            .limit(limit)
            .for("update", { skipLocked: true });
        if (due.length === 0) return [];
        const leaseUntil = new Date(Date.now() + leaseMs);
        return tx
            .update(planOrder)
            .set({ nextRetryAt: leaseUntil })
            .where(
                inArray(
                    planOrder.id,
                    due.map((row) => row.id),
                ),
            )
            .returning();
    });
}

export async function findOrdersToRun(
    limit: number,
    leaseMs = PLAN_CLAIM_LEASE_MS,
): Promise<PlanOrderRow[]> {
    return claimByStatus("pending", limit, leaseMs);
}

export async function claimSubmittedOrders(
    limit: number,
    leaseMs = PLAN_CLAIM_LEASE_MS,
): Promise<PlanOrderRow[]> {
    return claimByStatus("submitted", limit, leaseMs);
}

export async function markOrderExecuting(
    id: string,
    nextRetryAt: Date,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({
            status: "submitted",
            attempts: 0,
            lastError: null,
            nextRetryAt,
        })
        .where(and(eq(planOrder.id, id), eq(planOrder.status, "pending")))
        .returning();
    return row ?? null;
}

export async function markOrderSubmitted(
    id: string,
    txHash: string,
    nextRetryAt: Date,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ txHash, lastError: null, nextRetryAt })
        .where(
            and(
                eq(planOrder.id, id),
                eq(planOrder.status, "submitted"),
                isNull(planOrder.txHash),
            ),
        )
        .returning();
    return row ?? null;
}

export async function markOrderConfirmed(
    id: string,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ status: "confirmed", lastError: null, failureReason: null })
        .where(
            and(
                eq(planOrder.id, id),
                inArray(planOrder.status, [...IN_FLIGHT]),
            ),
        )
        .returning();
    return row ?? null;
}

export async function markOrderRetry(
    id: string,
    error: string,
    attempts: number,
    nextRetryAt: Date,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ status: "pending", lastError: error, attempts, nextRetryAt })
        .where(
            and(
                eq(planOrder.id, id),
                eq(planOrder.status, "pending"),
            ),
        )
        .returning();
    return row ?? null;
}

export async function markOrderFailed(
    id: string,
    error: string,
    failureReason: PlanFailureReason,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ status: "failed", lastError: error, failureReason })
        .where(
            and(
                eq(planOrder.id, id),
                inArray(planOrder.status, [...IN_FLIGHT]),
            ),
        )
        .returning();
    return row ?? null;
}

export async function recordReconciliationHash(
    id: string,
    txHash: string,
    error: string,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ txHash, lastError: error })
        .where(
            and(
                eq(planOrder.id, id),
                eq(planOrder.status, "failed"),
                eq(planOrder.failureReason, "needs_reconciliation"),
                isNull(planOrder.txHash),
            ),
        )
        .returning();
    return row ?? null;
}

/** Keeps a sent order in the submitted lane while its receipt is still pending. */
export async function extendSubmittedLease(
    id: string,
    error: string,
    attempts: number,
    nextRetryAt: Date,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ lastError: error, attempts, nextRetryAt })
        .where(and(eq(planOrder.id, id), eq(planOrder.status, "submitted")))
        .returning();
    return row ?? null;
}

export const planRepository = {
    insertOrderIfIdle,
    findOrder,
    findInFlightByCafe,
    findUnresolvedByCafe,
    listOrdersByCafe,
    findOrdersToRun,
    claimSubmittedOrders,
    markOrderExecuting,
    markOrderSubmitted,
    markOrderConfirmed,
    markOrderRetry,
    markOrderFailed,
    recordReconciliationHash,
    extendSubmittedLease,
};
