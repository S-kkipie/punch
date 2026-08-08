import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { listPendingRequestsForCafe } from "../../repository/redemption-requests";
import { toRedemptionRequest } from "../../repository/utils";

export const listCafeRedemptionInboxRoute = new Elysia().use(authed).get(
    "/:cafeId/redemption-inbox",
    async ({ user, params, status }) => {
        const membership = await requireCafeRole(user.id, params.cafeId, ["owner", "barista"]);
        if (!membership.ok) return status(membership.error.status as 500, errorToResponse(membership.error));
        const rows = await listPendingRequestsForCafe(params.cafeId);
        return status(200, CommonResponse.successful({ response: rows.map(toRedemptionRequest) }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String() }),
        response: { 200: t.Object({ status: t.Literal(200), response: t.Array(t.Any()) }), 401: errorResponseSchema(401), 403: errorResponseSchema(403), 500: errorResponseSchema(500) },
        detail: { tags: ["Consumption"], summary: "List a café's pending fulfillment inbox" },
    },
);
