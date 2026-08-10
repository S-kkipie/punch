import "server-only";

import type { PlanOrderView } from "@/core/plan/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { listOrdersByCafe } from "../repository/plan-repository";
import { findCafeMembership } from "./get-plan-status-service";
import { toPlanOrderView } from "./plan-view";

export type ListPlanOrdersDeps = {
    listOrdersByCafe: typeof listOrdersByCafe;
    findCafeMembership: typeof findCafeMembership;
};

const defaults: ListPlanOrdersDeps = { listOrdersByCafe, findCafeMembership };

export async function listPlanOrdersService(
    userId: string,
    cafeId: string,
    overrides: Partial<ListPlanOrdersDeps> = {},
): AsyncAppResult<PlanOrderView[]> {
    const d = { ...defaults, ...overrides };
    try {
        const membership = await d.findCafeMembership(userId, cafeId);
        if (!membership)
            return err(AppErrors.notFound({ targets: ["cafeId"] }));
        const rows = await d.listOrdersByCafe(cafeId);
        return ok(rows.map(toPlanOrderView));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
