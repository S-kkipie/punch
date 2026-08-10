import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import { redemptionRequest } from "@/server/drizzle/schemas/consumption-schema";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import {
    approveRedemptionAndEnqueueJob,
    createRedemptionRequest,
    listFulfillmentRequestsForCafe,
} from "../redemption-requests";

installIntegrationDbMutex();
const run =
    process.env.PUNCH_RUN_INTEGRATION === "1" ? describe : describe.skip;

run("redemption request repository", () => {
    it("approves and enqueues one idempotent PUNCH redemption job", async () => {
        const suffix = crypto.randomUUID();
        const userId = `integration-user-${suffix}`;
        const cafeId = `integration-cafe-${suffix}`;
        const productId = `integration-product-${suffix}`;
        const requestId = `integration-request-${suffix}`;
        const payload = {
            userWallet: "0x0000000000000000000000000000000000000abc",
            chainCafeId: 3,
            chainProductId: 7,
        };

        await db.insert(user).values({
            id: userId,
            name: "Integration User",
            email: `${suffix}@example.test`,
        });
        await db.insert(cafe).values({
            id: cafeId,
            name: "Integration Cafe",
            slug: `integration-${suffix}`,
        });
        await db.insert(cafeProduct).values({
            id: productId,
            cafeId,
            name: "Integration Reward",
            priceSoles: "12.00",
            type: "reward",
            approvalStatus: "approved",
            chainProductId: payload.chainProductId,
        });
        await db.insert(redemptionRequest).values({
            id: requestId,
            kind: "punch_reward",
            consumerUserId: userId,
            cafeId,
            productId,
            voucherId: null,
            status: "pending",
            rejectionReason: null,
            decidedByUserId: null,
        });

        try {
            const first = await approveRedemptionAndEnqueueJob(
                requestId,
                userId,
                payload,
            );
            const second = await approveRedemptionAndEnqueueJob(
                requestId,
                userId,
                payload,
            );
            expect(first.status).toBe("approved");
            expect(second.status).toBe("approved");

            const jobs = await db
                .select()
                .from(relayerJob)
                .where(eq(relayerJob.redemptionRequestId, requestId));
            expect(jobs).toHaveLength(1);
            expect(jobs[0]?.kind).toBe("punch_redemption");
            expect(jobs[0]?.payload).toEqual(payload);

            await db
                .delete(relayerJob)
                .where(eq(relayerJob.redemptionRequestId, requestId));
            await approveRedemptionAndEnqueueJob(requestId, userId, payload);
            const repairedJobs = await db
                .select()
                .from(relayerJob)
                .where(eq(relayerJob.redemptionRequestId, requestId));
            expect(repairedJobs).toHaveLength(1);
            expect(repairedJobs[0]?.payload).toEqual(payload);

            await expect(
                createRedemptionRequest({
                    kind: "punch_reward",
                    consumerUserId: userId,
                    cafeId,
                    productId,
                    voucherId: null,
                    status: "pending",
                    rejectionReason: null,
                    decidedByUserId: null,
                }),
            ).rejects.toMatchObject({
                cause: expect.objectContaining({
                    code: "23505",
                    constraint: "redemption_request_active_punch_uq",
                }),
            });
        } finally {
            await db
                .delete(relayerJob)
                .where(eq(relayerJob.redemptionRequestId, requestId));
            await db
                .delete(redemptionRequest)
                .where(
                    inArray(redemptionRequest.id, [
                        requestId,
                        `duplicate-${suffix}`,
                    ]),
                );
            await db.delete(cafeProduct).where(eq(cafeProduct.id, productId));
            await db.delete(cafe).where(eq(cafe.id, cafeId));
            await db.delete(user).where(eq(user.id, userId));
        }
    });

    it("keeps older actionable requests visible beyond the settled history cap", async () => {
        const suffix = crypto.randomUUID();
        const userId = `inbox-user-${suffix}`;
        const cafeId = `inbox-cafe-${suffix}`;
        const productId = `inbox-product-${suffix}`;
        const pendingId = `inbox-pending-${suffix}`;
        await db.insert(user).values({
            id: userId,
            name: "Inbox User",
            email: `inbox-${suffix}@example.test`,
        });
        await db.insert(cafe).values({
            id: cafeId,
            name: "Inbox Cafe",
            slug: `inbox-${suffix}`,
        });
        await db.insert(cafeProduct).values({
            id: productId,
            cafeId,
            name: "Inbox Reward",
            priceSoles: "12.00",
            type: "reward",
            approvalStatus: "approved",
        });
        const pendingCreatedAt = new Date("2026-01-01T00:00:00.000Z");
        await db.insert(redemptionRequest).values([
            {
                id: pendingId,
                kind: "punch_reward",
                consumerUserId: userId,
                cafeId,
                productId,
                status: "pending",
                createdAt: pendingCreatedAt,
                updatedAt: pendingCreatedAt,
            },
            ...Array.from({ length: 101 }, (_, index) => ({
                id: `inbox-settled-${index}-${suffix}`,
                kind: "punch_reward" as const,
                consumerUserId: userId,
                cafeId,
                productId,
                status: (index % 2 === 0 ? "confirmed" : "failed") as
                    | "confirmed"
                    | "failed",
                createdAt: new Date(
                    pendingCreatedAt.getTime() + (index + 1) * 1_000,
                ),
                updatedAt: new Date(
                    pendingCreatedAt.getTime() + (index + 1) * 1_000,
                ),
            })),
        ]);

        try {
            const rows = await listFulfillmentRequestsForCafe(cafeId);
            expect(rows.some(({ request }) => request.id === pendingId)).toBe(
                true,
            );
            expect(
                rows.filter(({ request }) =>
                    ["confirmed", "failed"].includes(request.status),
                ),
            ).toHaveLength(100);
        } finally {
            await db
                .delete(redemptionRequest)
                .where(eq(redemptionRequest.consumerUserId, userId));
            await db.delete(cafeProduct).where(eq(cafeProduct.id, productId));
            await db.delete(cafe).where(eq(cafe.id, cafeId));
            await db.delete(user).where(eq(user.id, userId));
        }
    });

    it("keeps an approved request visible until settlement or relayer enqueue", async () => {
        const suffix = crypto.randomUUID();
        const userId = `approved-inbox-user-${suffix}`;
        const cafeId = `approved-inbox-cafe-${suffix}`;
        const productId = `approved-inbox-product-${suffix}`;
        const requestId = `approved-inbox-request-${suffix}`;
        await db.insert(user).values({
            id: userId,
            name: "Approved Inbox User",
            email: `${suffix}@approved-inbox.test`,
        });
        await db.insert(cafe).values({
            id: cafeId,
            name: "Approved Inbox Cafe",
            slug: `approved-inbox-${suffix}`,
        });
        await db.insert(cafeProduct).values({
            id: productId,
            cafeId,
            name: "Approved Inbox Reward",
            priceSoles: "12.00",
            type: "reward",
            approvalStatus: "approved",
        });
        await db.insert(redemptionRequest).values({
            id: requestId,
            kind: "punch_reward",
            consumerUserId: userId,
            cafeId,
            productId,
            status: "approved",
        });
        try {
            const rows = await listFulfillmentRequestsForCafe(cafeId);
            expect(rows).toEqual([
                expect.objectContaining({
                    request: expect.objectContaining({ id: requestId }),
                    transactionId: null,
                    transactionStatus: null,
                }),
            ]);
        } finally {
            await db
                .delete(redemptionRequest)
                .where(eq(redemptionRequest.id, requestId));
            await db.delete(cafeProduct).where(eq(cafeProduct.id, productId));
            await db.delete(cafe).where(eq(cafe.id, cafeId));
            await db.delete(user).where(eq(user.id, userId));
        }
    });
});
