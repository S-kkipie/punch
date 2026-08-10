import "server-only";

import { mpenToSoles } from "@/core/plan/domain/schemas";
import type { PlanOrderView } from "@/core/plan/domain/types";
import type { PlanOrderRow } from "@/server/drizzle/schemas/plan-schema";

export function toPlanOrderView(row: PlanOrderRow): PlanOrderView {
    return {
        id: row.id,
        cafeId: row.cafeId,
        kind: row.kind,
        priceSoles: mpenToSoles(row.price),
        status: row.status,
        failureReason: row.failureReason,
        txHash: row.txHash,
        createdAt: row.createdAt.toISOString(),
    };
}
