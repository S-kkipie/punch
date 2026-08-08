import { Elysia } from "elysia";
import { cafeAdminSchema } from "@/core/cafe/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listCafesByStatusService } from "../../services/list-cafes-service";

export const listReviewQueueRoute = new Elysia().use(authed).get(
    "/review-queue",
    async ({ user, status }) => {
        const result = await listCafesByStatusService(user, "submitted");
        if (!result.ok)
            return status(
                result.error.status as 403 | 500,
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
            403: errorResponseSchema(403),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "List cafes awaiting review" },
    },
);
