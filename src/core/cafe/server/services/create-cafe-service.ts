import "server-only";
import type { CafeAdmin, CreateCafe } from "@/core/cafe/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { addMember } from "../repository/add-member";
import { createCafe } from "../repository/create-cafe";
import { toCafeAdmin } from "../repository/utils";

export async function createCafeService(
    userId: string,
    input: CreateCafe,
): AsyncAppResult<CafeAdmin> {
    try {
        const row = await createCafe(input);
        await addMember(userId, row.id, "owner");
        return ok(toCafeAdmin(row));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
