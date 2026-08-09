import "server-only";

import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { PurchaseOrderStatus } from "@/core/purchase/domain/types";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import {
    cafe,
    cafeMember,
    cafeProduct,
} from "@/server/drizzle/schemas/cafe-schema";
import {
    consumptionProof,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";
import {
    type PurchaseOrderRow,
    purchaseOrder,
    type RelayerJobRow,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";

export type PurchaseCafe = Pick<
    typeof cafe.$inferSelect,
    "id" | "chainCafeId" | "onboardingStatus"
>;
export type PurchaseProduct = Pick<
    typeof cafeProduct.$inferSelect,
    "id" | "cafeId" | "chainProductId" | "type" | "approvalStatus" | "active"
>;
export type PurchaseOrderWithChain = PurchaseOrderRow & {
    chainCafeId: number | null;
    chainProductId: number | null;
};

export async function findApprovedCafe(
    cafeId: string,
): Promise<PurchaseCafe | null> {
    const [row] = await db
        .select({
            id: cafe.id,
            chainCafeId: cafe.chainCafeId,
            onboardingStatus: cafe.onboardingStatus,
        })
        .from(cafe)
        .where(and(eq(cafe.id, cafeId), eq(cafe.onboardingStatus, "approved")))
        .limit(1);
    return row ?? null;
}

export async function findEmissionProduct(
    productId: string,
): Promise<PurchaseProduct | null> {
    const [row] = await db
        .select({
            id: cafeProduct.id,
            cafeId: cafeProduct.cafeId,
            chainProductId: cafeProduct.chainProductId,
            type: cafeProduct.type,
            approvalStatus: cafeProduct.approvalStatus,
            active: cafeProduct.active,
        })
        .from(cafeProduct)
        .where(eq(cafeProduct.id, productId))
        .limit(1);
    return row ?? null;
}

export async function insertOrder(
    values: typeof purchaseOrder.$inferInsert,
): Promise<PurchaseOrderRow> {
    const [row] = await db.insert(purchaseOrder).values(values).returning();
    return row;
}

export async function findOrder(
    orderId: string,
): Promise<PurchaseOrderWithChain | null> {
    const [row] = await db
        .select({
            id: purchaseOrder.id,
            cafeId: purchaseOrder.cafeId,
            userId: purchaseOrder.userId,
            productId: purchaseOrder.productId,
            amount: purchaseOrder.amount,
            yapeRef: purchaseOrder.yapeRef,
            receiptHash: purchaseOrder.receiptHash,
            nonce: purchaseOrder.nonce,
            expiry: purchaseOrder.expiry,
            status: purchaseOrder.status,
            failureReason: purchaseOrder.failureReason,
            txHash: purchaseOrder.txHash,
            createdAt: purchaseOrder.createdAt,
            updatedAt: purchaseOrder.updatedAt,
            chainCafeId: cafe.chainCafeId,
            chainProductId: cafeProduct.chainProductId,
        })
        .from(purchaseOrder)
        .innerJoin(cafe, eq(cafe.id, purchaseOrder.cafeId))
        .innerJoin(cafeProduct, eq(cafeProduct.id, purchaseOrder.productId))
        .where(eq(purchaseOrder.id, orderId))
        .limit(1);
    return row ?? null;
}

export async function findCafeOwner(
    cafeId: string,
): Promise<{ userId: string } | null> {
    const [row] = await db
        .select({ userId: cafeMember.userId })
        .from(cafeMember)
        .where(and(eq(cafeMember.cafeId, cafeId), eq(cafeMember.role, "owner")))
        .limit(1);
    return row ?? null;
}

export async function findUserWallet(userId: string): Promise<{
    walletIndex: number | null;
    walletAddress: string | null;
} | null> {
    const [row] = await db
        .select({
            walletIndex: user.walletIndex,
            walletAddress: user.walletAddress,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
    return row ?? null;
}

export type QueueOrderResult =
    | { outcome: "queued"; order: PurchaseOrderWithChain }
    | { outcome: "current"; order: PurchaseOrderWithChain };

export async function updateOrderAndQueue(
    orderId: string,
    payload: Record<string, unknown>,
): Promise<QueueOrderResult> {
    try {
        return await db.transaction(async (tx) => {
            const [transitioned] = await tx
                .update(purchaseOrder)
                .set({ status: "cafe_confirmed" })
                .where(
                    and(
                        eq(purchaseOrder.id, orderId),
                        eq(purchaseOrder.status, "user_confirmed"),
                        gte(purchaseOrder.expiry, new Date()),
                    ),
                )
                .returning({ id: purchaseOrder.id });
            if (!transitioned) {
                const [current] = await tx
                    .select({
                        id: purchaseOrder.id,
                        cafeId: purchaseOrder.cafeId,
                        userId: purchaseOrder.userId,
                        productId: purchaseOrder.productId,
                        amount: purchaseOrder.amount,
                        yapeRef: purchaseOrder.yapeRef,
                        receiptHash: purchaseOrder.receiptHash,
                        nonce: purchaseOrder.nonce,
                        expiry: purchaseOrder.expiry,
                        status: purchaseOrder.status,
                        failureReason: purchaseOrder.failureReason,
                        txHash: purchaseOrder.txHash,
                        createdAt: purchaseOrder.createdAt,
                        updatedAt: purchaseOrder.updatedAt,
                        chainCafeId: cafe.chainCafeId,
                        chainProductId: cafeProduct.chainProductId,
                    })
                    .from(purchaseOrder)
                    .innerJoin(cafe, eq(cafe.id, purchaseOrder.cafeId))
                    .innerJoin(
                        cafeProduct,
                        eq(cafeProduct.id, purchaseOrder.productId),
                    )
                    .where(eq(purchaseOrder.id, orderId));
                if (!current) throw new Error("purchase order not found");
                return { outcome: "current", order: current };
            }
            await tx.insert(relayerJob).values({ orderId, payload });
            await tx
                .update(purchaseOrder)
                .set({ status: "queued" })
                .where(eq(purchaseOrder.id, orderId));
            const [row] = await tx
                .select({
                    id: purchaseOrder.id,
                    cafeId: purchaseOrder.cafeId,
                    userId: purchaseOrder.userId,
                    productId: purchaseOrder.productId,
                    amount: purchaseOrder.amount,
                    yapeRef: purchaseOrder.yapeRef,
                    receiptHash: purchaseOrder.receiptHash,
                    nonce: purchaseOrder.nonce,
                    expiry: purchaseOrder.expiry,
                    status: purchaseOrder.status,
                    failureReason: purchaseOrder.failureReason,
                    txHash: purchaseOrder.txHash,
                    createdAt: purchaseOrder.createdAt,
                    updatedAt: purchaseOrder.updatedAt,
                    chainCafeId: cafe.chainCafeId,
                    chainProductId: cafeProduct.chainProductId,
                })
                .from(purchaseOrder)
                .innerJoin(cafe, eq(cafe.id, purchaseOrder.cafeId))
                .innerJoin(
                    cafeProduct,
                    eq(cafeProduct.id, purchaseOrder.productId),
                )
                .where(eq(purchaseOrder.id, orderId));
            if (!row)
                throw new Error(
                    "purchase order disappeared during confirmation",
                );
            return { outcome: "queued", order: row };
        });
    } catch (cause) {
        if ((cause as { code?: string })?.code !== "23505") throw cause;
        const current = await findOrder(orderId);
        if (!current) throw cause;
        return { outcome: "current", order: current };
    }
}

export async function listByUser(
    userId: string,
): Promise<PurchaseOrderWithChain[]> {
    return db
        .select({
            id: purchaseOrder.id,
            cafeId: purchaseOrder.cafeId,
            userId: purchaseOrder.userId,
            productId: purchaseOrder.productId,
            amount: purchaseOrder.amount,
            yapeRef: purchaseOrder.yapeRef,
            receiptHash: purchaseOrder.receiptHash,
            nonce: purchaseOrder.nonce,
            expiry: purchaseOrder.expiry,
            status: purchaseOrder.status,
            failureReason: purchaseOrder.failureReason,
            txHash: purchaseOrder.txHash,
            createdAt: purchaseOrder.createdAt,
            updatedAt: purchaseOrder.updatedAt,
            chainCafeId: cafe.chainCafeId,
            chainProductId: cafeProduct.chainProductId,
        })
        .from(purchaseOrder)
        .innerJoin(cafe, eq(cafe.id, purchaseOrder.cafeId))
        .innerJoin(cafeProduct, eq(cafeProduct.id, purchaseOrder.productId))
        .where(eq(purchaseOrder.userId, userId))
        .orderBy(desc(purchaseOrder.createdAt), desc(purchaseOrder.id));
}

export async function listByCafe(
    cafeId: string,
    status?: PurchaseOrderStatus,
): Promise<PurchaseOrderWithChain[]> {
    const conditions = [eq(purchaseOrder.cafeId, cafeId)];
    if (status) conditions.push(eq(purchaseOrder.status, status));
    return db
        .select({
            id: purchaseOrder.id,
            cafeId: purchaseOrder.cafeId,
            userId: purchaseOrder.userId,
            productId: purchaseOrder.productId,
            amount: purchaseOrder.amount,
            yapeRef: purchaseOrder.yapeRef,
            receiptHash: purchaseOrder.receiptHash,
            nonce: purchaseOrder.nonce,
            expiry: purchaseOrder.expiry,
            status: purchaseOrder.status,
            failureReason: purchaseOrder.failureReason,
            txHash: purchaseOrder.txHash,
            createdAt: purchaseOrder.createdAt,
            updatedAt: purchaseOrder.updatedAt,
            chainCafeId: cafe.chainCafeId,
            chainProductId: cafeProduct.chainProductId,
        })
        .from(purchaseOrder)
        .innerJoin(cafe, eq(cafe.id, purchaseOrder.cafeId))
        .innerJoin(cafeProduct, eq(cafeProduct.id, purchaseOrder.productId))
        .where(and(...conditions))
        .orderBy(desc(purchaseOrder.createdAt), desc(purchaseOrder.id));
}

export async function expirePurchases(): Promise<number> {
    const rows = await db
        .update(purchaseOrder)
        .set({ status: "expired" })
        .where(
            and(
                inArray(purchaseOrder.status, [
                    "user_confirmed",
                    "cafe_confirmed",
                ]),
                lte(purchaseOrder.expiry, new Date()),
            ),
        )
        .returning({ id: purchaseOrder.id });
    return rows.length;
}

export const RELAYER_CLAIM_LEASE_MS = 60_000;

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
) {
    return db.transaction(async (tx) => {
        const [job] = await tx
            .update(relayerJob)
            .set({
                status: "submitted",
                txHash,
                lastError: null,
                nextRetryAt,
            })
            .where(and(eq(relayerJob.id, id), eq(relayerJob.status, "pending")))
            .returning({
                kind: relayerJob.kind,
                orderId: relayerJob.orderId,
                redemptionRequestId: relayerJob.redemptionRequestId,
            });
        if (!job) return null;
        if (job.kind === "punch_redemption") return job;
        if (!job.orderId) throw new Error("consumption job missing orderId");
        const [order] = await tx
            .update(purchaseOrder)
            .set({ status: "submitted", txHash, failureReason: null })
            .where(
                and(
                    eq(purchaseOrder.id, job.orderId),
                    eq(purchaseOrder.status, "queued"),
                ),
            )
            .returning({ id: purchaseOrder.id });
        if (!order)
            throw new Error("relayer submitted order transition rejected");
        return job;
    });
}

export async function markJobConfirmed(id: string) {
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
            .returning({
                kind: relayerJob.kind,
                orderId: relayerJob.orderId,
                redemptionRequestId: relayerJob.redemptionRequestId,
            });

        if (!job) {
            const [currentJob] = await tx
                .select({
                    kind: relayerJob.kind,
                    jobStatus: relayerJob.status,
                    orderId: relayerJob.orderId,
                })
                .from(relayerJob)
                .where(eq(relayerJob.id, id));
            if (
                currentJob?.kind === "punch_redemption" &&
                currentJob.jobStatus === "confirmed"
            )
                return null;
            if (!currentJob) return null;
            const [currentOrder] = await tx
                .select({ status: purchaseOrder.status })
                .from(purchaseOrder)
                .where(eq(purchaseOrder.id, currentJob.orderId as string));
            if (
                currentOrder?.status === "confirmed" &&
                currentJob.jobStatus === "confirmed"
            )
                return null;
            throw new Error("relayer confirmed order transition rejected");
        }
        if (job.kind === "punch_redemption") return job;
        if (!job.orderId) throw new Error("consumption job missing orderId");

        const [order] = await tx
            .update(purchaseOrder)
            .set({ status: "confirmed", failureReason: null })
            .where(
                and(
                    eq(purchaseOrder.id, job.orderId),
                    inArray(purchaseOrder.status, ["queued", "submitted"]),
                ),
            )
            .returning({ id: purchaseOrder.id });
        if (order) return job;

        const [currentOrder] = await tx
            .select({ status: purchaseOrder.status })
            .from(purchaseOrder)
            .where(eq(purchaseOrder.id, job.orderId));
        if (currentOrder?.status === "confirmed") return job;

        throw new Error("relayer confirmed order transition rejected");
    });
}

export async function markJobRetry(
    id: string,
    error: string,
    attempts: number,
    nextRetryAt: Date,
) {
    return db.transaction(async (tx) => {
        const [job] = await tx
            .update(relayerJob)
            .set({
                status: "pending",
                lastError: error,
                attempts,
                nextRetryAt,
            })
            .where(
                and(
                    eq(relayerJob.id, id),
                    inArray(relayerJob.status, ["pending", "submitted"]),
                ),
            )
            .returning({
                kind: relayerJob.kind,
                orderId: relayerJob.orderId,
                redemptionRequestId: relayerJob.redemptionRequestId,
            });
        if (!job) return null;
        if (job.kind === "punch_redemption") return job;
        if (!job.orderId) throw new Error("consumption job missing orderId");
        const [order] = await tx
            .update(purchaseOrder)
            .set({ status: "queued" })
            .where(
                and(
                    eq(purchaseOrder.id, job.orderId),
                    inArray(purchaseOrder.status, ["queued", "submitted"]),
                ),
            )
            .returning({ id: purchaseOrder.id });
        if (!order) throw new Error("relayer retry order transition rejected");
        return job;
    });
}

export async function markJobPending(id: string, nextRetryAt: Date) {
    return db.transaction(async (tx) => {
        const [job] = await tx
            .update(relayerJob)
            .set({ status: "pending", nextRetryAt, lastError: null })
            .where(
                and(eq(relayerJob.id, id), eq(relayerJob.status, "submitted")),
            )
            .returning({
                kind: relayerJob.kind,
                orderId: relayerJob.orderId,
                redemptionRequestId: relayerJob.redemptionRequestId,
            });
        if (!job) return null;
        if (job.kind === "punch_redemption") return job;
        if (!job.orderId) throw new Error("consumption job missing orderId");
        const [order] = await tx
            .update(purchaseOrder)
            .set({ status: "queued" })
            .where(
                and(
                    eq(purchaseOrder.id, job.orderId),
                    eq(purchaseOrder.status, "submitted"),
                ),
            )
            .returning({ id: purchaseOrder.id });
        if (!order)
            throw new Error("relayer pending order transition rejected");
        return job;
    });
}

export async function markJobFailed(
    id: string,
    error: string,
    failureReason: string,
) {
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
            .returning({
                kind: relayerJob.kind,
                orderId: relayerJob.orderId,
                redemptionRequestId: relayerJob.redemptionRequestId,
            });
        if (!job) return null;
        if (job.kind === "punch_redemption") {
            if (job.redemptionRequestId) {
                await tx
                    .update(redemptionRequest)
                    .set({ status: "failed", failureReason })
                    .where(
                        and(
                            eq(redemptionRequest.id, job.redemptionRequestId),
                            eq(redemptionRequest.status, "approved"),
                        ),
                    );
            }
            return job;
        }
        if (!job.orderId) throw new Error("consumption job missing orderId");
        const [order] = await tx
            .update(purchaseOrder)
            .set({ status: "failed", failureReason })
            .where(
                and(
                    eq(purchaseOrder.id, job.orderId),
                    inArray(purchaseOrder.status, ["queued", "submitted"]),
                ),
            )
            .returning({ id: purchaseOrder.id });
        if (!order) throw new Error("relayer failed order transition rejected");
        await tx
            .update(consumptionProof)
            .set({ status: "failed", failureReason })
            .where(
                and(
                    eq(consumptionProof.purchaseOrderId, job.orderId),
                    eq(consumptionProof.status, "submitted"),
                ),
            );
        return job;
    });
}

export async function setOrderStatus(
    orderId: string,
    status: PurchaseOrderStatus,
    extra?: { failureReason?: string; txHash?: string },
) {
    const [row] = await db
        .update(purchaseOrder)
        .set({ status, ...extra })
        .where(eq(purchaseOrder.id, orderId))
        .returning();
    return row;
}

export const purchaseRepository = {
    findApprovedCafe,
    findEmissionProduct,
    insertOrder,
    findOrder,
    findCafeOwner,
    findUserWallet,
    listByUser,
    listByCafe,
    updateOrderAndQueue,
    expirePurchases,
    findJobsToRun,
    claimSubmittedJobs,
    markJobSubmitted,
    markJobConfirmed,
    markJobRetry,
    markJobPending,
    markJobFailed,
    setOrderStatus,
};
