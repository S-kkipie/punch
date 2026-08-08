import { Elysia } from "elysia";
import { z } from "zod";
import { cafeAdminSchema } from "@/core/cafe/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { submitCafeService } from "../../services/submit-cafe-service";

export const submitCafeRoute = new Elysia().use(authed).post(
    "/:id/submit",
    async ({ user, params, status }) => {
        const result = await submitCafeService(user.id, params.id);
        if (!result.ok)
            return status(
                result.error.status as 403 | 404 | 409 | 422 | 500,
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
        response: {
            200: successResponseSchema(cafeAdminSchema, "Cafe"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "Submit a cafe for review" },
    },
);
