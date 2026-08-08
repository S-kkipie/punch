import "server-only";
import type { CafeAdmin, UpdateCafe } from "@/core/cafe/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findCafeById } from "../repository/find-cafe-by-id";
import { updateCafe } from "../repository/update-cafe";
import { toCafeAdmin } from "../repository/utils";

export async function updateCafeService(
    userId: string,
    cafeId: string,
    patch: UpdateCafe,
): AsyncAppResult<CafeAdmin> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;
        const row = await findCafeById(cafeId);
        if (!row) return err(AppErrors.notFound({ targets: ["cafeId"] }));
        if (row.onboardingStatus === "submitted")
            return err(AppErrors.conflict({ targets: ["onboardingStatus"] }));
        const updated = await updateCafe(cafeId, patch);
        return ok(toCafeAdmin(updated));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
