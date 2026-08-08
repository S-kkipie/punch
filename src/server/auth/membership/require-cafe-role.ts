import "server-only";
import {
    AppErrors,
    type AppResult,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import type {
    CafeMemberRole,
    CafeMemberRow,
} from "@/server/drizzle/schemas/cafe-schema";
import { findMembership } from "./repository";

export async function requireCafeRole(
    userId: string,
    cafeId: string,
    roles: CafeMemberRole[],
): AsyncAppResult<CafeMemberRow> {
    const membership = await findMembership(userId, cafeId);
    if (!membership || !roles.includes(membership.role)) {
        return err(AppErrors.forbidden());
    }
    return ok(membership);
}

export function requireOps(user: { isOps?: boolean | null }): AppResult<true> {
    if (!user.isOps) return err(AppErrors.forbidden());
    return ok(true);
}
