import "server-only";
import type { Product, ProductAdmin } from "@/core/cafe/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { listProductsByCafe } from "../repository/list-products-by-cafe";
import { toProduct, toProductAdmin } from "../repository/utils";
export async function listProductsService(
    viewer: { id: string; isOps?: boolean | null } | null,
    cafeId: string,
): AsyncAppResult<Product[] | ProductAdmin[]> {
    try {
        const rows = await listProductsByCafe(cafeId);
        const privileged =
            viewer?.isOps === true ||
            (viewer
                ? (await requireCafeRole(viewer.id, cafeId, ["owner"])).ok
                : false);
        const visible = privileged
            ? rows
            : rows.filter(
                  (row) => row.approvalStatus === "approved" && row.active,
              );
        return ok(
            privileged ? visible.map(toProductAdmin) : visible.map(toProduct),
        );
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
