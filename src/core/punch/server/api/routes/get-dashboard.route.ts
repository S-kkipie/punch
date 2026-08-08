import { Elysia } from "elysia";
import { dashboardSchema } from "@/core/punch/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { getDashboardService } from "../../services/get-dashboard-service";

export const getDashboardRoute = new Elysia().use(authed).get(
    "/dashboard",
    async ({ user, status }) => {
        const result = await getDashboardService(user.id);
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
            200: successResponseSchema(dashboardSchema, "Dashboard"),
            401: errorResponseSchema(401),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Punch"], summary: "Consultar el panel de PUNCH" },
    },
);
