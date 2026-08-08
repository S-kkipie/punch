import "server-only";
import { eq } from "drizzle-orm";
import type { ConsumerVoucher } from "@/core/punch/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { consumerVoucher } from "@/server/drizzle/schemas/punch-schema";

export async function listVouchersService(
    userId: string,
): AsyncAppResult<ConsumerVoucher[]> {
    try {
        const now = new Date();
        const rows = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, userId));
        return ok(
            rows.map((row) => ({
                id: row.id,
                source: row.source,
                cafeId: row.cafeId,
                status:
                    row.status === "available" && row.expiresAt <= now
                        ? "expired"
                        : row.status,
                expiresAt: row.expiresAt.toISOString(),
                redeemedAt: row.redeemedAt?.toISOString() ?? null,
            })),
        );
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
