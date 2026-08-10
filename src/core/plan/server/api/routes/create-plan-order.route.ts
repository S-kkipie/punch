import { Elysia } from "elysia";
import {
    createPlanOrderSchema,
    planOrderSchema,
} from "@/core/plan/domain/schemas";
import { createPlanOrderService } from "@/core/plan/server/services/create-plan-order-service";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    createdResponseSchema,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";

export const createPlanOrderRoute = new Elysia().use(authed).post(
    "/orders",
    async ({ user, body, status }) => {
        const result = await createPlanOrderService(user.id, body);
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        body: createPlanOrderSchema,
        response: {
            201: createdResponseSchema(planOrderSchema, "PlanOrder"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Plans"], summary: "Create a plan or pack order" },
    },
);
