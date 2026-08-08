import "server-only";
import type { Cafe, CafeAdmin } from "@/core/cafe/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findCafeById } from "../repository/find-cafe-by-id";
import { toCafe, toCafeAdmin } from "../repository/utils";

export async function getCafeService(
    viewer: { id: string; isOps?: boolean | null } | null,
    cafeId: string,
): AsyncAppResult<Cafe | CafeAdmin> {
    try {
        const row = await findCafeById(cafeId);
        if (!row) return err(AppErrors.notFound({ targets: ["cafeId"] }));
        if (viewer?.isOps) return ok(toCafeAdmin(row));
        if (viewer) {
            const membership = await requireCafeRole(viewer.id, cafeId, [
                "owner",
            ]);
            if (membership.ok) return ok(toCafeAdmin(row));
        }
        if (row.onboardingStatus !== "approved")
            return err(AppErrors.notFound({ targets: ["cafeId"] }));
        return ok(toCafe(row));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
