import "server-only";
import { createProductSchema } from "@/core/cafe/domain/schemas";
import type { Product, UpdateProduct } from "@/core/cafe/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findProductById } from "../repository/find-product-by-id";
import { updateProduct } from "../repository/update-product";
import { toProduct } from "../repository/utils";
export async function updateProductService(
    userId: string,
    productId: string,
    patch: UpdateProduct,
): AsyncAppResult<Product> {
    try {
        const row = await findProductById(productId);
        if (!row) return err(AppErrors.notFound({ targets: ["productId"] }));
        const auth = await requireCafeRole(userId, row.cafeId, ["owner"]);
        if (!auth.ok) return auth;
        const merged = {
            name: patch.name ?? row.name,
            description: patch.description ?? row.description ?? undefined,
            priceSoles: patch.priceSoles ?? row.priceSoles,
            cogsSoles: patch.cogsSoles ?? row.cogsSoles ?? undefined,
            type: patch.type ?? row.type,
        };
        const revalidated = createProductSchema.safeParse(merged);
        if (!revalidated.success)
            return err(
                AppErrors.unprocessableEntity({
                    targets: revalidated.error.issues.map((i) =>
                        String(i.path[0]),
                    ),
                    cause: revalidated.error,
                }),
            );
        const economicChange =
            (patch.priceSoles !== undefined &&
                patch.priceSoles !== row.priceSoles) ||
            (patch.type !== undefined && patch.type !== row.type) ||
            (patch.cogsSoles !== undefined &&
                patch.cogsSoles !== row.cogsSoles);
        const updated = await updateProduct(productId, {
            ...patch,
            ...(economicChange ? { approvalStatus: "pending" } : {}),
        });
        return ok(toProduct(updated));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
