import "server-only";
import type { CreateProduct, Product } from "@/core/cafe/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { createProduct } from "../repository/create-product";
import { toProduct } from "../repository/utils";
export async function createProductService(
    userId: string,
    cafeId: string,
    input: CreateProduct,
): AsyncAppResult<Product> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;
        const row = await createProduct({
            ...input,
            cafeId,
            approvalStatus: "pending",
            description: input.description ?? null,
        });
        return ok(toProduct(row));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
