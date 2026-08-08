import { Elysia } from "elysia";
import { z } from "zod";
import { createProductSchema, productSchema } from "@/core/cafe/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { createProductService } from "../../services/create-product-service";
export const createProductRoute = new Elysia().use(authed).post(
    "/:id/products",
    async ({ user, params, body, status }) => {
        const result = await createProductService(user.id, params.id, body);
        if (!result.ok)
            return status(
                result.error.status as 403 | 404 | 422 | 500,
                errorToResponse(result.error),
            );
        return status(
            201,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        params: z.object({ id: z.string() }),
        body: createProductSchema,
        response: {
            201: successResponseSchema(productSchema, "Product"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "Create a cafe product" },
    },
);
