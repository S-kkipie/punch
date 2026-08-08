import "server-only";

import { and, eq, inArray, lte } from "drizzle-orm";
import type { PurchaseOrderStatus } from "@/core/purchase/domain/types";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import {
    cafe,
    cafeMember,
    cafeProduct,
} from "@/server/drizzle/schemas/cafe-schema";
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
    "id" | "cafeId" | "chainProductId" | "type" | "approvalStatus"
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

export async function updateOrderAndQueue(
    orderId: string,
    payload: Record<string, unknown>,
): Promise<PurchaseOrderWithChain> {
    try {
        return await db.transaction(async (tx) => {
            await tx
                .update(purchaseOrder)
                .set({ status: "cafe_confirmed" })
                .where(
                    and(
                        eq(purchaseOrder.id, orderId),
                        eq(purchaseOrder.status, "user_confirmed"),
                    ),
                );
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
            return row;
        });
    } catch (cause) {
        if ((cause as { code?: string })?.code !== "23505") throw cause;
        const current = await findOrder(orderId);
        if (!current) throw cause;
        return current;
    }
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

export async function findJobsToRun(limit: number): Promise<RelayerJobRow[]> {
    return db.transaction(async (tx) =>
        tx
            .select()
            .from(relayerJob)
            .where(
                and(
                    eq(relayerJob.status, "pending"),
                    lte(relayerJob.nextRetryAt, new Date()),
                ),
            )
            .limit(limit)
            .for("update", { skipLocked: true }),
    );
}

export async function markJobSubmitted(id: string, txHash: string) {
    const [row] = await db
        .update(relayerJob)
        .set({ status: "submitted", txHash })
        .where(eq(relayerJob.id, id))
        .returning();
    return row;
}

export async function markJobConfirmed(id: string) {
    const [job] = await db
        .update(relayerJob)
        .set({ status: "confirmed" })
        .where(eq(relayerJob.id, id))
        .returning({ orderId: relayerJob.orderId });
    if (job)
        await setOrderStatus(job.orderId, "confirmed", { txHash: undefined });
    return job;
}

export async function markJobRetry(
    id: string,
    error: string,
    attempts: number,
) {
    const [row] = await db
        .update(relayerJob)
        .set({
            status: "pending",
            lastError: error,
            attempts,
            nextRetryAt: new Date(Date.now() + 30_000),
        })
        .where(eq(relayerJob.id, id))
        .returning();
    return row;
}

export async function markJobFailed(id: string, error: string) {
    const [job] = await db
        .update(relayerJob)
        .set({ status: "failed", lastError: error })
        .where(eq(relayerJob.id, id))
        .returning({ orderId: relayerJob.orderId });
    if (job)
        await setOrderStatus(job.orderId, "failed", { failureReason: error });
    return job;
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
    updateOrderAndQueue,
    expirePurchases,
    findJobsToRun,
    markJobSubmitted,
    markJobConfirmed,
    markJobRetry,
    markJobFailed,
    setOrderStatus,
};
