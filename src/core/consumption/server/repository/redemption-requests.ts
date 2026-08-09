import "server-only";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { type DbClient, db } from "@/server/drizzle/db";
import {
    consumerTransaction,
    type NewRedemptionRequestRow,
    type RedemptionRequestRow,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";

export class RedemptionRequestRepositoryError extends Error {
    constructor(
        public code:
            | "REQUEST_NOT_FOUND"
            | "REQUEST_NOT_PENDING"
            | "INVALID_TRANSITION",
        message: string,
    ) {
        super(message);
        this.name = "RedemptionRequestRepositoryError";
    }
}

export async function createRedemptionRequest(
    input: Omit<NewRedemptionRequestRow, "id" | "createdAt" | "updatedAt">,
    client: DbClient = db,
): Promise<RedemptionRequestRow> {
    const [row] = await client
        .insert(redemptionRequest)
        .values(input)
        .returning();
    if (!row)
        throw new Error("createRedemptionRequest: insert returned no row");
    return row;
}

export async function approveRedemptionAndEnqueueJob(
    requestId: string,
    deciderUserId: string,
    payload: {
        userWallet: string;
        chainCafeId: number;
        chainProductId: number;
    },
): Promise<RedemptionRequestRow> {
    return db.transaction(async (tx) => {
        const [existing] = await tx
            .select()
            .from(redemptionRequest)
            .where(eq(redemptionRequest.id, requestId))
            .for("update");
        if (!existing) {
            throw new RedemptionRequestRepositoryError(
                "REQUEST_NOT_FOUND",
                `Redemption request ${requestId} not found`,
            );
        }
        if (existing.status === "approved" || existing.status === "confirmed") {
            return existing;
        }
        if (existing.status !== "pending") {
            throw new RedemptionRequestRepositoryError(
                "INVALID_TRANSITION",
                `Redemption request ${requestId} cannot be approved`,
            );
        }

        const [updated] = await tx
            .update(redemptionRequest)
            .set({ status: "approved", decidedByUserId: deciderUserId })
            .where(
                and(
                    eq(redemptionRequest.id, requestId),
                    eq(redemptionRequest.status, "pending"),
                ),
            )
            .returning();
        if (!updated) {
            throw new RedemptionRequestRepositoryError(
                "INVALID_TRANSITION",
                `Redemption request ${requestId} cannot be approved`,
            );
        }
        await tx
            .insert(relayerJob)
            .values({
                kind: "punch_redemption",
                redemptionRequestId: requestId,
                payload,
            })
            .onConflictDoNothing({ target: relayerJob.redemptionRequestId });
        return updated;
    });
}

export async function findRedemptionRequestById(
    id: string,
    client: DbClient = db,
): Promise<RedemptionRequestRow | null> {
    const [row] = await client
        .select()
        .from(redemptionRequest)
        .where(eq(redemptionRequest.id, id));
    return row ?? null;
}

export async function findActiveVoucherRedemptionRequest(
    voucherId: string,
    client: DbClient = db,
): Promise<RedemptionRequestRow | null> {
    const [row] = await client
        .select()
        .from(redemptionRequest)
        .where(
            and(
                eq(redemptionRequest.voucherId, voucherId),
                or(
                    eq(redemptionRequest.status, "pending"),
                    eq(redemptionRequest.status, "approved"),
                ),
            ),
        );
    return row ?? null;
}

export async function decideRedemptionRequest(
    id: string,
    decidedByUserId: string,
    decision: "approved" | "rejected",
    rejectionReason: string | null,
    client: DbClient = db,
): Promise<RedemptionRequestRow> {
    const [row] = await client
        .update(redemptionRequest)
        .set({ status: decision, decidedByUserId, rejectionReason })
        .where(
            and(
                eq(redemptionRequest.id, id),
                eq(redemptionRequest.status, "pending"),
            ),
        )
        .returning();
    if (row) return row;

    const [existing] = await client
        .select({ status: redemptionRequest.status })
        .from(redemptionRequest)
        .where(eq(redemptionRequest.id, id));
    if (!existing) {
        throw new RedemptionRequestRepositoryError(
            "REQUEST_NOT_FOUND",
            `Redemption request ${id} not found`,
        );
    }
    throw new RedemptionRequestRepositoryError(
        "REQUEST_NOT_PENDING",
        `Redemption request ${id} is not pending`,
    );
}

export async function listFulfillmentRequestsForCafe(cafeId: string) {
    return db
        .select({
            request: redemptionRequest,
            transactionId: consumerTransaction.id,
            transactionStatus: consumerTransaction.status,
        })
        .from(redemptionRequest)
        .leftJoin(
            consumerTransaction,
            eq(consumerTransaction.redemptionRequestId, redemptionRequest.id),
        )
        .where(
            and(
                eq(redemptionRequest.cafeId, cafeId),
                or(
                    eq(redemptionRequest.status, "pending"),
                    inArray(consumerTransaction.status, [
                        "pending",
                        "failed",
                        "rejected",
                    ]),
                ),
            ),
        )
        .orderBy(desc(redemptionRequest.createdAt));
}
