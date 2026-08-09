import "server-only";
import type { RedemptionRequest } from "@/core/consumption/domain/types";
import type { RedemptionRequestRow } from "@/server/drizzle/schemas/consumption-schema";

export function toRedemptionRequest(
    row: RedemptionRequestRow,
): RedemptionRequest {
    return {
        id: row.id,
        kind: row.kind,
        cafeId: row.cafeId,
        productId: row.productId,
        voucherId: row.voucherId,
        status: row.status,
        rejectionReason: row.rejectionReason,
        failureReason: row.failureReason,
        createdAt: row.createdAt.toISOString(),
    };
}
