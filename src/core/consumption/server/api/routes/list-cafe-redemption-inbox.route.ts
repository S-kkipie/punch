import { Elysia, t } from "elysia";
import { redemptionRequestSchema } from "@/core/consumption/domain/schemas";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listFulfillmentRequestsForCafe } from "../../repository/redemption-requests";
import { toRedemptionRequest } from "../../repository/utils";

export const listCafeRedemptionInboxRoute = new Elysia().use(authed).get(
    "/:cafeId/redemption-inbox",
    async ({ user, params, status }) => {
        const membership = await requireCafeRole(user.id, params.cafeId, [
            "owner",
            "barista",
        ]);
        if (!membership.ok)
            return status(
                membership.error.status as 500,
                errorToResponse(membership.error),
            );
        const rows = await listFulfillmentRequestsForCafe(params.cafeId);
        return status(
            200,
            CommonResponse.successful({
                response: rows.map(
                    ({ request, transactionId, transactionStatus }) => ({
                        ...toRedemptionRequest(request),
                        transactionId,
                        transactionStatus,
                    }),
                ),
            }),
        );
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String() }),
        response: {
            200: successResponseSchema(
                redemptionRequestSchema.array(),
                "RedemptionRequests",
            ),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary:
                "List a café's recent actionable and settled fulfillment requests",
        },
    },
);
