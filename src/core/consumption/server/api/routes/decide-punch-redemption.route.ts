import { Elysia, t } from "elysia";
import { z } from "zod";
import {
    consumerTransactionStatusSchema,
    decideRedemptionRequestSchema,
    redemptionRequestSchema,
} from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { decidePunchRedemptionService } from "../../services/decide-punch-redemption-service";

const decisionResponseSchema = z.union([
    redemptionRequestSchema,
    z.object({
        transactionId: z.string(),
        status: consumerTransactionStatusSchema,
    }),
]);

export const decidePunchRedemptionRoute = new Elysia().use(authed).post(
    "/:cafeId/punch-redemptions/:requestId/decide",
    async ({ user, params, body, status }) => {
        const result = await decidePunchRedemptionService(
            user.id,
            params.cafeId,
            params.requestId,
            body,
        );
        if (!result.ok) {
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        }
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String(), requestId: t.String() }),
        body: decideRedemptionRequestSchema,
        response: {
            200: successResponseSchema(
                decisionResponseSchema,
                "RedemptionDecision",
            ),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Approve or reject a PUNCH redemption",
        },
    },
);
