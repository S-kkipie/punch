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

const approvedCafeFields = new Set<keyof UpdateCafe>([
    "description",
    "photoUrl",
    "contactPhone",
]);

const criticalCafeFields = [
    "name",
    "address",
    "district",
    "ruc",
    "lat",
    "lng",
] as const;

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
        if (row.onboardingStatus === "submitted") {
            return err(AppErrors.conflict({ targets: ["onboardingStatus"] }));
        }
        if (row.onboardingStatus === "approved") {
            const changedCriticalFields = criticalCafeFields.filter(
                (field) => patch[field] !== undefined,
            );
            const changedUnsupportedFields = (
                Object.keys(patch) as (keyof UpdateCafe)[]
            ).filter((field) => !approvedCafeFields.has(field));
            const criticalFields = new Set<string>(criticalCafeFields);
            const targets = [
                ...changedCriticalFields,
                ...changedUnsupportedFields.filter(
                    (field) => !criticalFields.has(field),
                ),
            ];
            if (targets.length > 0) {
                return err(AppErrors.conflict({ targets }));
            }
        }
        const updated = await updateCafe(cafeId, patch);
        return ok(toCafeAdmin(updated));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
