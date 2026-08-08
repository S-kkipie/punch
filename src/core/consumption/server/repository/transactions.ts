import "server-only";
import { eq } from "drizzle-orm";
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
): Promise<ConsumerTransactionRow | null> {
    const [row] = await db
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
): Promise<ConsumerTransactionRow | null> {
    const [row] = await client
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.id, id));
    return row ?? null;
}

export async function updateTransactionStatus(
    client: DbClient,
    id: string,
    status: ConsumerTransactionStatus,
    rejectionReason: string | null = null,
): Promise<ConsumerTransactionRow> {
    const [row] = await client
        .update(consumerTransaction)
        .set({ status, rejectionReason })
        .where(eq(consumerTransaction.id, id))
        .returning();
    if (!row) throw new Error("updateTransactionStatus: transaction not found");
    return row;
}
