import { Elysia } from "elysia";
import { z } from "zod";
import { cafeAdminSchema, cafeSchema } from "@/core/cafe/domain/schemas";
import { auth } from "@/server/auth/auth";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { getCafeService } from "../../services/get-cafe-service";

export const getCafeRoute = new Elysia().get(
    "/:id",
    async ({ request, params, status }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        const viewer = session
            ? { id: session.user.id, isOps: session.user.isOps }
            : null;
        const result = await getCafeService(viewer, params.id);
        if (!result.ok)
            return status(
                result.error.status as 404 | 500,
                errorToResponse(result.error),
            );
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        params: z.object({ id: z.string() }),
        response: {
            200: successResponseSchema(
                z.union([cafeAdminSchema, cafeSchema]),
                "Cafe",
            ),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "Get a cafe by id" },
    },
);
