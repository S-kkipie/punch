import { Elysia, t } from "elysia";
import { decideRedemptionRequestSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse, successResponseSchema } from "@/server/common/responses";
import { redemptionRequestSchema } from "@/core/consumption/domain/schemas";
import { decidePunchRedemptionService } from "../../services/decide-punch-redemption-service";

export const decidePunchRedemptionRoute = new Elysia().use(authed).post(
    "/:cafeId/punch-redemptions/:requestId/decide",
    async ({ user, params, body, status }) => {
        const result = await decidePunchRedemptionService(user.id, params.cafeId, params.requestId, body);
        if (!result.ok) return status(result.error.status as 500, errorToResponse(result.error));
        return status(200, CommonResponse.successful({ response: result.data }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String(), requestId: t.String() }),
        body: decideRedemptionRequestSchema,
        response: { 200: successResponseSchema(t.Any(), "RedemptionDecision"), 400: errorResponseSchema(400), 401: errorResponseSchema(401), 404: errorResponseSchema(404), 500: errorResponseSchema(500) },
        detail: { tags: ["Consumption"], summary: "Approve or reject a PUNCH redemption" },
    },
);
