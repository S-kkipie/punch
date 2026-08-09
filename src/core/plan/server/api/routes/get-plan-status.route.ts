import { Elysia } from "elysia";
import { z } from "zod";
import { planStatusSchema } from "@/core/plan/domain/schemas";
import { getPlanStatusService } from "@/core/plan/server/services/get-plan-status-service";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";

export const getPlanStatusRoute = new Elysia().use(authed).get(
    "/cafes/:cafeId/status",
    async ({ user, params, status }) => {
        const result = await getPlanStatusService(user.id, params.cafeId);
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
        params: z.object({ cafeId: z.string().min(1) }),
        response: {
            200: successResponseSchema(planStatusSchema, "PlanStatus"),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Plans"], summary: "Get a cafe's plan status" },
    },
);
