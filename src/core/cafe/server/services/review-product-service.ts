import "server-only";
import type { Product, Review } from "@/core/cafe/domain/types";
import { requireOps } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findProductById } from "../repository/find-product-by-id";
import { updateProduct } from "../repository/update-product";
import { toProduct } from "../repository/utils";
export async function reviewProductService(
    user: { id: string; isOps?: boolean | null },
    productId: string,
    review: Review,
): AsyncAppResult<Product> {
    try {
        const ops = requireOps(user);
        if (!ops.ok) return ops;
        const row = await findProductById(productId);
        if (!row) return err(AppErrors.notFound({ targets: ["productId"] }));
        if (row.approvalStatus !== "pending")
            return err(AppErrors.conflict({ targets: ["approvalStatus"] }));
        const updated = await updateProduct(productId, {
            approvalStatus:
                review.decision === "approved" ? "approved" : "rejected",
            reviewNote: review.reviewNote ?? null,
        });
        return ok(toProduct(updated));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
