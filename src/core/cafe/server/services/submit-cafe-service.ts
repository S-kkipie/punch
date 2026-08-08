import "server-only";
import { canTransition, submissionGaps } from "@/core/cafe/domain/transitions";
import type { CafeAdmin } from "@/core/cafe/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { countEmissionProducts } from "../repository/count-emission-products";
import { findCafeById } from "../repository/find-cafe-by-id";
import { updateCafe } from "../repository/update-cafe";
import { toCafeAdmin } from "../repository/utils";

export async function submitCafeService(
    userId: string,
    cafeId: string,
): AsyncAppResult<CafeAdmin> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;
        const row = await findCafeById(cafeId);
        if (!row) return err(AppErrors.notFound({ targets: ["cafeId"] }));
        if (!canTransition(row.onboardingStatus, "submitted"))
            return err(AppErrors.conflict({ targets: ["onboardingStatus"] }));
        const gaps = submissionGaps(
            toCafeAdmin(row),
            await countEmissionProducts(cafeId),
        );
        if (gaps.length)
            return err(AppErrors.unprocessableEntity({ targets: gaps }));
        const updated = await updateCafe(cafeId, {
            onboardingStatus: "submitted",
            reviewNote: null,
        });
        return ok(toCafeAdmin(updated));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
