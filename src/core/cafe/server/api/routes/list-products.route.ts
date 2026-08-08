import { Elysia } from "elysia";
import { z } from "zod";
import { productAdminSchema, productSchema } from "@/core/cafe/domain/schemas";
import { auth } from "@/server/auth/auth";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listProductsService } from "../../services/list-products-service";
export const listProductsRoute = new Elysia().get(
    "/:id/products",
    async ({ request, params, status }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        const viewer = session
            ? { id: session.user.id, isOps: session.user.isOps }
            : null;
        const result = await listProductsService(viewer, params.id);
        if (!result.ok) return status(500, errorToResponse(result.error));
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        params: z.object({ id: z.string() }),
        response: {
            200: successResponseSchema(
                z.union([productAdminSchema.array(), productSchema.array()]),
                "Products",
            ),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "List cafe products" },
    },
);
