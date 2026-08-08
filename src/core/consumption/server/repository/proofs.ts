import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { type DbClient, db } from "@/server/drizzle/db";
import {
    type ConsumptionProofRow,
    consumptionProof,
    type NewConsumptionProofRow,
} from "@/server/drizzle/schemas/consumption-schema";

export async function createProof(
    input: Omit<NewConsumptionProofRow, "id" | "createdAt" | "updatedAt">,
    client: DbClient = db,
): Promise<ConsumptionProofRow> {
    const [row] = await client
        .insert(consumptionProof)
        .values(input)
        .returning();
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
    const matches = await client
        .select()
        .from(consumptionProof)
        .where(
            or(
                eq(consumptionProof.nonce, nonce),
                eq(consumptionProof.receiptHash, receiptHash),
            ),
        );
    const nonceProof = matches.find((proof) => proof.nonce === nonce);
    const receiptProof = matches.find(
        (proof) => proof.receiptHash === receiptHash,
    );
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
            expired: sql<boolean>`${consumptionProof.expiresAt} <= now()`,
        })
        .from(consumptionProof)
        .where(eq(consumptionProof.id, id));
    if (existing?.status === "issued" && existing.expired) {
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
