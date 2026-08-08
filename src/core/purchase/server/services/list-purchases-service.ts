import "server-only";

import type { PurchaseOrderStatus } from "@/core/purchase/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import {
    type PurchaseOrderWithChain,
    purchaseRepository,
} from "../repository/purchase-repository";
import { toPurchaseView } from "./purchase-view";

type ListDeps = {
    listByUser: typeof purchaseRepository.listByUser;
    listByCafe: typeof purchaseRepository.listByCafe;
    requireMember: typeof requireCafeRole;
};

const defaults: ListDeps = {
    listByUser: purchaseRepository.listByUser,
    listByCafe: purchaseRepository.listByCafe,
    requireMember: requireCafeRole,
};

const views = (rows: PurchaseOrderWithChain[]) => rows.map(toPurchaseView);

export async function listMyPurchasesService(
    userId: string,
    deps: Partial<ListDeps> = {},
): AsyncAppResult<ReturnType<typeof views>> {
    try {
        const d = { ...defaults, ...deps };
        return ok(views(await d.listByUser(userId)));
    } catch {
        return err(AppErrors.unexpected(new Error("purchase listing failed")));
    }
}

export async function listCafePurchasesService(
    userId: string,
    cafeId: string,
    status?: PurchaseOrderStatus,
    deps: Partial<ListDeps> = {},
): AsyncAppResult<ReturnType<typeof views>> {
    try {
        const d = { ...defaults, ...deps };
        const membership = await d.requireMember(userId, cafeId, [
            "owner",
            "barista",
        ]);
        if (!membership.ok) return membership;
        return ok(views(await d.listByCafe(cafeId, status)));
    } catch {
        return err(
            AppErrors.unexpected(new Error("cafe purchase listing failed")),
        );
    }
}
