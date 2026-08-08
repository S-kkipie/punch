import "server-only";
import type { ConsumerVoucher } from "@/core/punch/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { listConsumerVouchersForUser } from "../repository/dashboard";

export async function listVouchersService(
    userId: string,
): AsyncAppResult<ConsumerVoucher[]> {
    try {
        const now = new Date();
        const rows = await listConsumerVouchersForUser(userId);
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
