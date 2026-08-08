import { Elysia } from "elysia";
import { z } from "zod";
import { cafeAdminSchema, updateCafeSchema } from "@/core/cafe/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { updateCafeService } from "../../services/update-cafe-service";

export const updateCafeRoute = new Elysia().use(authed).patch(
    "/:id",
    async ({ user, params, body, status }) => {
        const result = await updateCafeService(user.id, params.id, body);
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
        body: updateCafeSchema,
        response: {
            200: successResponseSchema(cafeAdminSchema, "Cafe"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "Update a cafe by id" },
    },
);
