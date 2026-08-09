import { Elysia } from "elysia";
import { z } from "zod";
import { planOrderSchema } from "@/core/plan/domain/schemas";
import { listPlanOrdersService } from "@/core/plan/server/services/list-plan-orders-service";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";

export const listPlanOrdersRoute = new Elysia().use(authed).get(
    "/cafes/:cafeId/orders",
    async ({ user, params, status }) => {
        const result = await listPlanOrdersService(user.id, params.cafeId);
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
            200: successResponseSchema(
                z.array(planOrderSchema),
                "PlanOrderList",
            ),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Plans"], summary: "List a cafe's plan payments" },
    },
);
