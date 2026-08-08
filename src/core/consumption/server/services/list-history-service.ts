import "server-only";
import { desc, eq } from "drizzle-orm";
import { type AsyncAppResult, ok } from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { consumerTransaction } from "@/server/drizzle/schemas/consumption-schema";

export type HistoryEntry = {
    id: string;
    operation: "emission" | "punch_redemption" | "voucher_redemption";
    cafeId: string;
    status: "pending" | "confirmed" | "rejected" | "failed";
    rejectionReason: string | null;
    createdAt: string;
};

export async function listHistoryService(
    consumerUserId: string,
): AsyncAppResult<HistoryEntry[]> {
    const rows = await db
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.consumerUserId, consumerUserId))
        .orderBy(desc(consumerTransaction.createdAt));

    return ok(
        rows.map((row) => ({
            id: row.id,
            operation: row.operation,
            cafeId: row.cafeId,
            status: row.status,
            rejectionReason: row.rejectionReason,
            createdAt: row.createdAt.toISOString(),
        })),
    );
}
