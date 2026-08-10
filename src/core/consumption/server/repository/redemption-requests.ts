import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
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
        if (existing.status === "confirmed") {
            return existing;
        }
        if (existing.status === "approved") {
            await tx
                .insert(relayerJob)
                .values({
                    idempotencyKey: `punch_redemption:${requestId}`,
                    kind: "punch_redemption",
                    redemptionRequestId: requestId,
                    payload,
                })
                .onConflictDoNothing({
                    target: relayerJob.redemptionRequestId,
                });
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
                idempotencyKey: `punch_redemption:${requestId}`,
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

export type RedemptionSettlement = {
    id: string;
    operation: "punch_redemption" | "voucher_redemption";
    consumerUserId: string;
    cafeId: string;
    status: "pending" | "confirmed" | "rejected" | "failed";
    rejectionReason: string | null;
    createdAt: Date;
    source: "consumer_transaction" | "relayer_job";
};

export function normalizeRedemptionSettlement(input: {
    id: string;
    operation?: "punch_redemption" | "voucher_redemption";
    consumerUserId: string;
    cafeId: string;
    createdAt: Date;
    transactionStatus?:
        | "pending"
        | "submitted"
        | "confirmed"
        | "failed"
        | "rejected"
        | null;
    jobStatus?: "pending" | "submitted" | "confirmed" | "failed" | null;
    rejectionReason?: string | null;
    lastError?: string | null;
    source: RedemptionSettlement["source"];
}): RedemptionSettlement {
    const status: RedemptionSettlement["status"] =
        input.transactionStatus === "submitted"
            ? "pending"
            : (input.transactionStatus ??
              (input.jobStatus === "submitted"
                  ? "pending"
                  : (input.jobStatus ?? "pending")));
    return {
        id: input.id,
        operation: input.operation ?? "voucher_redemption",
        consumerUserId: input.consumerUserId,
        cafeId: input.cafeId,
        status,
        rejectionReason:
            input.rejectionReason ??
            (status === "failed" ? (input.lastError ?? null) : null),
        createdAt: input.createdAt,
        source: input.source,
    };
}

const relayerRequestId = sql`${relayerJob.payload}->>'redemptionRequestId'`;

export async function findRedemptionSettlementById(
    id: string,
): Promise<RedemptionSettlement | null> {
    const [transaction] = await db
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.id, id));
    if (transaction) {
        if (transaction.operation === "emission") return null;
        return normalizeRedemptionSettlement({
            id: transaction.id,
            operation: transaction.operation,
            consumerUserId: transaction.consumerUserId,
            cafeId: transaction.cafeId,
            createdAt: transaction.createdAt,
            transactionStatus: transaction.status,
            rejectionReason: transaction.rejectionReason,
            source: "consumer_transaction",
        });
    }
    const [job] = await db
        .select({ job: relayerJob, request: redemptionRequest })
        .from(relayerJob)
        .innerJoin(
            redemptionRequest,
            eq(relayerRequestId, redemptionRequest.id),
        )
        .where(eq(relayerJob.id, id));
    if (!job) return null;
    return normalizeRedemptionSettlement({
        id: job.job.id,
        consumerUserId: job.request.consumerUserId,
        cafeId: job.request.cafeId,
        createdAt: job.job.createdAt,
        jobStatus: job.job.status,
        lastError: job.job.lastError,
        source: "relayer_job",
    });
}

export async function listFulfillmentRequestsForCafe(
    cafeId: string,
    client: DbClient = db,
) {
    const rows = await client
        .select({
            request: redemptionRequest,
            transactionId: consumerTransaction.id,
            transactionStatus: consumerTransaction.status,
            transactionRejectionReason: consumerTransaction.rejectionReason,
            transactionCreatedAt: consumerTransaction.createdAt,
            jobId: relayerJob.id,
            jobStatus: relayerJob.status,
            jobLastError: relayerJob.lastError,
            jobCreatedAt: relayerJob.createdAt,
        })
        .from(redemptionRequest)
        .leftJoin(
            consumerTransaction,
            and(
                eq(
                    consumerTransaction.redemptionRequestId,
                    redemptionRequest.id,
                ),
                inArray(consumerTransaction.operation, [
                    "punch_redemption",
                    "voucher_redemption",
                ]),
                eq(consumerTransaction.cafeId, redemptionRequest.cafeId),
                eq(
                    consumerTransaction.consumerUserId,
                    redemptionRequest.consumerUserId,
                ),
            ),
        )
        .leftJoin(
            relayerJob,
            and(
                eq(relayerJob.kind, "voucher_redeem"),
                eq(relayerRequestId, redemptionRequest.id),
            ),
        )
        .where(
            and(
                eq(redemptionRequest.cafeId, cafeId),
                or(
                    eq(redemptionRequest.status, "pending"),
                    and(
                        eq(redemptionRequest.status, "approved"),
                        inArray(relayerJob.status, [
                            "pending",
                            "submitted",
                            "failed",
                        ]),
                    ),
                    inArray(redemptionRequest.status, ["confirmed", "failed"]),
                    inArray(consumerTransaction.status, [
                        "pending",
                        "confirmed",
                        "failed",
                    ]),
                    inArray(relayerJob.status, [
                        "pending",
                        "submitted",
                        "failed",
                    ]),
                ),
            ),
        )
        .orderBy(desc(redemptionRequest.createdAt));
    const mapped = rows.map((row) => {
        const settlement = row.transactionId
            ? normalizeRedemptionSettlement({
                  id: row.transactionId,
                  consumerUserId: row.request.consumerUserId,
                  cafeId: row.request.cafeId,
                  createdAt: row.transactionCreatedAt ?? row.request.createdAt,
                  transactionStatus: row.transactionStatus,
                  rejectionReason: row.transactionRejectionReason,
                  source: "consumer_transaction",
              })
            : row.jobId
              ? normalizeRedemptionSettlement({
                    id: row.jobId,
                    consumerUserId: row.request.consumerUserId,
                    cafeId: row.request.cafeId,
                    createdAt: row.jobCreatedAt ?? row.request.createdAt,
                    jobStatus: row.jobStatus,
                    lastError: row.jobLastError,
                    source: "relayer_job",
                })
              : null;
        return {
            request: row.request,
            transactionId: settlement?.id ?? null,
            transactionStatus: settlement?.status ?? null,
            transactionFailureReason: settlement?.rejectionReason ?? null,
        };
    });
    const actionable = mapped.filter(
        ({ request }) => !["confirmed", "failed"].includes(request.status),
    );
    const settled = mapped
        .filter(({ request }) =>
            ["confirmed", "failed"].includes(request.status),
        )
        .slice(0, 100);
    return [...actionable, ...settled].sort(
        (a, b) => b.request.createdAt.getTime() - a.request.createdAt.getTime(),
    );
}
