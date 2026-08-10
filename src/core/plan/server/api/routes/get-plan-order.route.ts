import { Elysia } from "elysia";
import { z } from "zod";
import { planOrderSchema } from "@/core/plan/domain/schemas";
import { getPlanOrderService } from "@/core/plan/server/services/get-plan-order-service";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";

export const getPlanOrderRoute = new Elysia().use(authed).get(
    "/orders/:id",
    async ({ user, params, status }) => {
        const result = await getPlanOrderService(user.id, params.id);
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
        params: z.object({ id: z.string().min(1) }),
        response: {
            200: successResponseSchema(planOrderSchema, "PlanOrder"),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Plans"], summary: "Get a plan order" },
    },
);
