import { Elysia } from "elysia";
import { cafeAdminSchema } from "@/core/cafe/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listMyCafesService } from "../../services/list-my-cafes-service";

export const listMyCafesRoute = new Elysia().use(authed).get(
    "/my",
    async ({ user, status }) => {
        const result = await listMyCafesService(user.id);
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        response: {
            200: successResponseSchema(cafeAdminSchema.array(), "Cafes"),
            401: errorResponseSchema(401),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Cafes"],
            summary: "List cafes owned by current user",
        },
    },
);
