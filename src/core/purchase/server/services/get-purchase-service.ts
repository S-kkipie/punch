import "server-only";

import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { AppErrors, err, ok, type AsyncAppResult } from "@/server/common/responses";
import { purchaseRepository } from "../repository/purchase-repository";
import { toPurchaseView } from "./purchase-view";

type GetDeps = {
    findOrder: typeof purchaseRepository.findOrder;
    requireMember: typeof requireCafeRole;
};
const defaults: GetDeps = {
    findOrder: purchaseRepository.findOrder,
    requireMember: requireCafeRole,
};

export async function getPurchaseService(userId: string, orderId: string, deps: Partial<GetDeps> = {}): AsyncAppResult<ReturnType<typeof toPurchaseView>> {
    try {
        const d = { ...defaults, ...deps };
        const order = await d.findOrder(orderId);
        if (!order) return err(AppErrors.notFound({ targets: ["orderId"] }));
        if (order.userId !== userId) {
            const membership = await d.requireMember(userId, order.cafeId, ["owner"]);
            if (!membership.ok) return membership;
        }
        return ok(toPurchaseView(order));
    } catch {
        return err(AppErrors.unexpected(new Error("purchase lookup failed")));
    }
}
