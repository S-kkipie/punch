import "server-only";
import { and, eq, sql } from "drizzle-orm";
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

export class ProofRepositoryError extends Error {
    constructor(
        public code: "PROOF_COLLISION" | "PROOF_EXPIRED" | "PROOF_NOT_ISSUED",
        message: string,
    ) {
        super(message);
        this.name = "ProofRepositoryError";
    }
}

export async function findProofByNonceOrReceipt(
    nonce: string,
    receiptHash: string,
    client: DbClient = db,
): Promise<ConsumptionProofRow | null> {
    const [nonceMatch, receiptMatch] = await Promise.all([
        client
            .select()
            .from(consumptionProof)
            .where(eq(consumptionProof.nonce, nonce)),
        client
            .select()
            .from(consumptionProof)
            .where(eq(consumptionProof.receiptHash, receiptHash)),
    ]);
    const nonceProof = nonceMatch[0];
    const receiptProof = receiptMatch[0];
    if (nonceProof && receiptProof && nonceProof.id !== receiptProof.id) {
        throw new ProofRepositoryError(
            "PROOF_COLLISION",
            "Nonce and receipt hash identify different proofs",
        );
    }
    return nonceProof ?? receiptProof ?? null;
}

export async function bindProofSignatures(
    id: string,
    consumerUserId: string,
    cafeSignature: string,
    consumerSignature: string,
    client: DbClient = db,
): Promise<ConsumptionProofRow> {
    const [row] = await client
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
                sql`${consumptionProof.expiresAt} > now()`,
            ),
        )
        .returning();
    if (row) return row;

    const [existing] = await client
        .select({
            status: consumptionProof.status,
            expiresAt: consumptionProof.expiresAt,
        })
        .from(consumptionProof)
        .where(eq(consumptionProof.id, id));
    if (existing?.status === "issued" && existing.expiresAt <= new Date()) {
        throw new ProofRepositoryError(
            "PROOF_EXPIRED",
            `Proof ${id} has expired`,
        );
    }
    throw new ProofRepositoryError(
        "PROOF_NOT_ISSUED",
        `Proof ${id} is not issued or does not exist`,
    );
}
