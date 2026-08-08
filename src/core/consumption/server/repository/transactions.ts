import "server-only";
import { and, eq, or } from "drizzle-orm";
import { canTransitionTransaction } from "@/core/consumption/domain/transitions";
import type { ConsumerTransactionStatus } from "@/core/consumption/domain/types";
import { type DbClient, db } from "@/server/drizzle/db";
import {
    type ConsumerTransactionRow,
    consumerTransaction,
    type NewConsumerTransactionRow,
} from "@/server/drizzle/schemas/consumption-schema";

export async function createTransaction(
    client: DbClient,
    input: Omit<NewConsumerTransactionRow, "id" | "createdAt" | "updatedAt">,
): Promise<ConsumerTransactionRow> {
    const [row] = await client
        .insert(consumerTransaction)
        .values(input)
        .returning();
    if (!row) throw new Error("createTransaction: insert returned no row");
    return row;
}

export async function findTransactionByIdempotencyKey(
    key: string,
    client: DbClient = db,
): Promise<ConsumerTransactionRow | null> {
    const [row] = await client
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.idempotencyKey, key));
    return row ?? null;
}

export async function findTransactionByProofId(
    client: DbClient,
    proofId: string,
): Promise<ConsumerTransactionRow | null> {
    const [row] = await client
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.proofId, proofId));
    return row ?? null;
}

export async function findTransactionByRedemptionRequestId(
    client: DbClient,
    redemptionRequestId: string,
): Promise<ConsumerTransactionRow | null> {
    const [row] = await client
        .select()
        .from(consumerTransaction)
        .where(
            eq(consumerTransaction.redemptionRequestId, redemptionRequestId),
        );
    return row ?? null;
}

export async function findTransactionById(
    id: string,
    client: DbClient = db,
    forUpdate = false,
): Promise<ConsumerTransactionRow | null> {
    const query = client
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.id, id));
    const [row] = forUpdate ? await query.for("update") : await query;
    return row ?? null;
}

export class TransactionRepositoryError extends Error {
    constructor(
        public code: "TRANSACTION_NOT_FOUND" | "INVALID_TRANSITION",
        message: string,
    ) {
        super(message);
        this.name = "TransactionRepositoryError";
    }
}

export async function updateTransactionStatus(
    client: DbClient,
    id: string,
    status: ConsumerTransactionStatus,
    rejectionReason: string | null = null,
): Promise<ConsumerTransactionRow> {
    const transitionableFrom = (
        ["pending", "confirmed", "rejected", "failed"] as const
    ).filter((current) => canTransitionTransaction(current, status));
    const [row] = transitionableFrom.length
        ? await client
              .update(consumerTransaction)
              .set({ status, rejectionReason })
              .where(
                  and(
                      eq(consumerTransaction.id, id),
                      or(
                          ...transitionableFrom.map((current) =>
                              eq(consumerTransaction.status, current),
                          ),
                      ),
                  ),
              )
              .returning()
        : [];
    if (row) return row;

    const [existing] = await client
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.id, id));
    if (!existing) {
        throw new TransactionRepositoryError(
            "TRANSACTION_NOT_FOUND",
            `Transaction ${id} not found`,
        );
    }
    if (
        existing.status === status &&
        (status === "confirmed" || status === "rejected" || status === "failed")
    ) {
        return existing;
    }
    throw new TransactionRepositoryError(
        "INVALID_TRANSITION",
        `Cannot transition transaction ${id} from ${existing.status} to ${status}`,
    );
}
