import { Elysia } from "elysia";
import { productSchema } from "@/core/cafe/domain/schemas";
import { requireOps } from "@/server/auth/membership/require-cafe-role";
import { authed } from "@/server/auth/middleware/authed";
import {
    AppErrors,
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listPendingProducts } from "../../repository/list-pending-products";
import { toProduct } from "../../repository/utils";
export const listPendingProductsRoute = new Elysia().use(authed).get(
    "/products/pending",
    async ({ user, status }) => {
        const auth = requireOps(user);
        if (!auth.ok) return status(403, errorToResponse(auth.error));
        try {
            const rows = await listPendingProducts();
            return status(
                200,
                CommonResponse.successful({ response: rows.map(toProduct) }),
            );
        } catch (cause) {
            return status(500, errorToResponse(AppErrors.unexpected(cause)));
        }
    },
    {
        authed: true,
        response: {
            200: successResponseSchema(productSchema.array(), "Products"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "List pending cafe products" },
    },
);
