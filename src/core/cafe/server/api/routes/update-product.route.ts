import { Elysia } from "elysia";
import { z } from "zod";
import { productSchema, updateProductSchema } from "@/core/cafe/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { updateProductService } from "../../services/update-product-service";
export const updateProductRoute = new Elysia().use(authed).patch(
    "/products/:productId",
    async ({ user, params, body, status }) => {
        const result = await updateProductService(
            user.id,
            params.productId,
            body,
        );
        if (!result.ok)
            return status(
                result.error.status as 403 | 404 | 422 | 500,
                errorToResponse(result.error),
            );
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        params: z.object({ productId: z.string() }),
        body: updateProductSchema,
        response: {
            200: successResponseSchema(productSchema, "Product"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "Update a cafe product" },
    },
);
