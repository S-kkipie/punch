import "server-only";
import type { CafeAdmin } from "@/core/cafe/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { listCafesByMember } from "../repository/list-cafes-by-member";
import { toCafeAdmin } from "../repository/utils";

export async function listMyCafesService(
    userId: string,
): AsyncAppResult<CafeAdmin[]> {
    try {
        const rows = await listCafesByMember(userId);
        return ok(rows.map(({ cafe }) => toCafeAdmin(cafe)));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
