import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { type DbClient, db } from "@/server/drizzle/db";
import {
    type NewRedemptionRequestRow,
    type RedemptionRequestRow,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";

export class RedemptionRequestRepositoryError extends Error {
    constructor(
        public code: "REQUEST_NOT_FOUND" | "REQUEST_NOT_PENDING",
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

export async function listPendingRequestsForCafe(
    cafeId: string,
): Promise<RedemptionRequestRow[]> {
    return db
        .select()
        .from(redemptionRequest)
        .where(
            and(
                eq(redemptionRequest.cafeId, cafeId),
                eq(redemptionRequest.status, "pending"),
            ),
        )
        .orderBy(desc(redemptionRequest.createdAt));
}
