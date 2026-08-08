import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { type DbClient, db } from "@/server/drizzle/db";
import {
    type NewRedemptionRequestRow,
    type RedemptionRequestRow,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";

export async function createRedemptionRequest(
    input: Omit<NewRedemptionRequestRow, "id" | "createdAt" | "updatedAt">,
): Promise<RedemptionRequestRow> {
    const [row] = await db.insert(redemptionRequest).values(input).returning();
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
): Promise<RedemptionRequestRow> {
    const [row] = await db
        .update(redemptionRequest)
        .set({ status: decision, decidedByUserId, rejectionReason })
        .where(
            and(
                eq(redemptionRequest.id, id),
                eq(redemptionRequest.status, "pending"),
            ),
        )
        .returning();
    if (!row)
        throw new Error(
            "decideRedemptionRequest: request not pending or not found",
        );
    return row;
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
