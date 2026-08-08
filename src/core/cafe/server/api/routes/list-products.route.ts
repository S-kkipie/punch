import { Elysia } from "elysia";
import { z } from "zod";
import { productSchema } from "@/core/cafe/domain/schemas";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listProductsService } from "../../services/list-products-service";
export const listProductsRoute = new Elysia().get(
    "/:id/products",
    async ({ params, status }) => {
        const result = await listProductsService(null, params.id);
        if (!result.ok) return status(500, errorToResponse(result.error));
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        params: z.object({ id: z.string() }),
        response: {
            200: successResponseSchema(productSchema.array(), "Products"),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "List cafe products" },
    },
);
