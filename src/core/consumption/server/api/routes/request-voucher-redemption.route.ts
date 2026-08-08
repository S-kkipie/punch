import { Elysia, t } from "elysia";
import {
    redemptionRequestSchema,
    requestVoucherRedemptionSchema,
} from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    createdResponseSchema,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { requestVoucherRedemptionService } from "../../services/request-voucher-redemption-service";

export const requestVoucherRedemptionRoute = new Elysia().use(authed).post(
    "/:cafeId/voucher-redemptions",
    async ({ user, params, body, status }) => {
        const result = await requestVoucherRedemptionService(
            user.id,
            params.cafeId,
            body,
        );
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String() }),
        body: requestVoucherRedemptionSchema,
        response: {
            201: createdResponseSchema(
                redemptionRequestSchema,
                "RedemptionRequest",
            ),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Solicitar canje de voucher",
        },
    },
);
