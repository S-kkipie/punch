import "server-only";
import { canTransition } from "@/core/cafe/domain/transitions";
import type { CafeAdmin, Review } from "@/core/cafe/domain/types";
import { requireOps } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findCafeById } from "../repository/find-cafe-by-id";
import { updateCafe } from "../repository/update-cafe";
import { toCafeAdmin } from "../repository/utils";

export async function reviewCafeService(
    user: { id: string; isOps?: boolean | null },
    cafeId: string,
    review: Review,
): AsyncAppResult<CafeAdmin> {
    try {
        const ops = requireOps(user);
        if (!ops.ok) return ops;
        const row = await findCafeById(cafeId);
        if (!row) return err(AppErrors.notFound({ targets: ["cafeId"] }));
        if (!canTransition(row.onboardingStatus, review.decision))
            return err(AppErrors.conflict({ targets: ["onboardingStatus"] }));
        const updated = await updateCafe(cafeId, {
            onboardingStatus: review.decision,
            reviewNote: review.reviewNote ?? null,
        });
        return ok(toCafeAdmin(updated));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
