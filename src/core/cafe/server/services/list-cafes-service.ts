import "server-only";
import type {
    Cafe,
    CafeAdmin,
    CafeOnboardingStatus,
} from "@/core/cafe/domain/types";
import { requireOps } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { listApprovedCafes } from "../repository/list-approved-cafes";
import { listCafesByStatus } from "../repository/list-cafes-by-status";
import { toCafe, toCafeAdmin } from "../repository/utils";

export async function listCafesService(): AsyncAppResult<Cafe[]> {
    try {
        return ok((await listApprovedCafes()).map(toCafe));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}

export async function listCafesByStatusService(
    user: { id: string; isOps?: boolean | null },
    status: CafeOnboardingStatus,
): AsyncAppResult<CafeAdmin[]> {
    try {
        const auth = requireOps(user);
        if (!auth.ok) return auth;
        return ok((await listCafesByStatus(status)).map(toCafeAdmin));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
