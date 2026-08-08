import { Elysia, t } from "elysia";
import { requestPunchRedemptionSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { requestPunchRedemptionService } from "../../services/request-punch-redemption-service";

export const requestPunchRedemptionRoute = new Elysia().use(authed).post(
    "/:cafeId/punch-redemptions",
    async ({ user, params, body, status }) => {
        const result = await requestPunchRedemptionService(user.id, params.cafeId, body);
        if (!result.ok) return status(result.error.status as 500, errorToResponse(result.error));
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String() }),
        body: requestPunchRedemptionSchema,
        response: {
            201: t.Object({ status: t.Literal(201), response: t.Any() }),
            400: errorResponseSchema(400), 401: errorResponseSchema(401),
            404: errorResponseSchema(404), 422: errorResponseSchema(422),
        },
        detail: { tags: ["Consumption"], summary: "Request a PUNCH reward redemption" },
    },
);
