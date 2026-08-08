import { Elysia } from "elysia";
import { z } from "zod";
import { cafeAdminSchema, reviewSchema } from "@/core/cafe/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { reviewCafeService } from "../../services/review-cafe-service";

export const reviewCafeRoute = new Elysia().use(authed).post(
    "/:id/review",
    async ({ user, params, body, status }) => {
        const result = await reviewCafeService(user, params.id, body);
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
        params: z.object({ id: z.string() }),
        body: reviewSchema,
        response: {
            200: successResponseSchema(cafeAdminSchema, "Cafe"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "Review a cafe" },
    },
);
