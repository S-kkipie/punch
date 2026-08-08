import { Elysia } from "elysia";
import { cafeAdminSchema, createCafeSchema } from "@/core/cafe/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    createdResponseSchema,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { createCafeService } from "../../services/create-cafe-service";

export const createCafeRoute = new Elysia().use(authed).post(
    "/",
    async ({ user, body, status }) => {
        const result = await createCafeService(user.id, body);
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        body: createCafeSchema,
        response: {
            201: createdResponseSchema(cafeAdminSchema, "Cafe"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "Create a cafe" },
    },
);
