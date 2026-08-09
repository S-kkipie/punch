import "server-only";

import type { PlanOrderView } from "@/core/plan/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findOrder } from "../repository/plan-repository";
import { findCafeMembership } from "./get-plan-status-service";
import { toPlanOrderView } from "./plan-view";

export type GetPlanOrderDeps = {
    findOrder: typeof findOrder;
    findCafeMembership: typeof findCafeMembership;
};

const defaults: GetPlanOrderDeps = { findOrder, findCafeMembership };

export async function getPlanOrderService(
    userId: string,
    orderId: string,
    overrides: Partial<GetPlanOrderDeps> = {},
): AsyncAppResult<PlanOrderView> {
    const d = { ...defaults, ...overrides };
    try {
        const row = await d.findOrder(orderId);
        if (!row) return err(AppErrors.notFound({ targets: ["orderId"] }));
        const membership = await d.findCafeMembership(userId, row.cafeId);
        if (!membership)
            return err(AppErrors.notFound({ targets: ["orderId"] }));
        return ok(toPlanOrderView(row));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
