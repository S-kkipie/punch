import "server-only";
import { and, eq, or } from "drizzle-orm";
import { type DbClient, db } from "@/server/drizzle/db";
import {
    type ConsumptionProofRow,
    consumptionProof,
    type NewConsumptionProofRow,
} from "@/server/drizzle/schemas/consumption-schema";

export async function createProof(
    input: Omit<NewConsumptionProofRow, "id" | "createdAt" | "updatedAt">,
): Promise<ConsumptionProofRow> {
    const [row] = await db.insert(consumptionProof).values(input).returning();
    if (!row) throw new Error("createProof: insert returned no row");
    return row;
}

export async function findProofById(
    id: string,
    client: DbClient = db,
): Promise<ConsumptionProofRow | null> {
    const [row] = await client
        .select()
        .from(consumptionProof)
        .where(eq(consumptionProof.id, id));
    return row ?? null;
}

export async function findProofByNonceOrReceipt(
    nonce: string,
    receiptHash: string,
): Promise<ConsumptionProofRow | null> {
    const [row] = await db
        .select()
        .from(consumptionProof)
        .where(
            or(
                eq(consumptionProof.nonce, nonce),
                eq(consumptionProof.receiptHash, receiptHash),
            ),
        );
    return row ?? null;
}

export async function bindProofSignatures(
    id: string,
    consumerUserId: string,
    cafeSignature: string,
    consumerSignature: string,
): Promise<ConsumptionProofRow> {
    const [row] = await db
        .update(consumptionProof)
        .set({
            status: "confirmed",
            consumerUserId,
            cafeSignature,
            consumerSignature,
        })
        .where(
            and(
                eq(consumptionProof.id, id),
                eq(consumptionProof.status, "issued"),
            ),
        )
        .returning();
    if (!row)
        throw new Error("bindProofSignatures: proof not issued or not found");
    return row;
}
