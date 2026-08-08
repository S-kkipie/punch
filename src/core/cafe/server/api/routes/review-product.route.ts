import { Elysia } from "elysia";
import { z } from "zod";
import { productSchema, reviewSchema } from "@/core/cafe/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { reviewProductService } from "../../services/review-product-service";
export const reviewProductRoute = new Elysia().use(authed).post(
    "/products/:productId/review",
    async ({ user, params, body, status }) => {
        const result = await reviewProductService(user, params.productId, body);
        if (!result.ok)
            return status(
                result.error.status as 403 | 404 | 409 | 500,
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
        body: reviewSchema,
        response: {
            200: successResponseSchema(productSchema, "Product"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "Review a cafe product" },
    },
);
