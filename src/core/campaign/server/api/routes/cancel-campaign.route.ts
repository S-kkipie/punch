import { Elysia } from "elysia";
import { z } from "zod";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { cancelCampaignService } from "../../services/cancel-campaign-service";

export const cancelCampaignRoute = new Elysia().use(authed).post(
    "/cafe/:cafeId/campaigns/:campaignId/cancel",
    async ({ user, params, status }) => {
        const result = await cancelCampaignService(
            user.id,
            params.cafeId,
            params.campaignId,
        );
        if (!result.ok)
            return status(
                result.error.status as 403 | 404 | 409 | 500,
                errorToResponse(result.error),
            );
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        params: z.object({
            cafeId: z.string().min(1),
            campaignId: z.string().min(1),
        }),
        response: {
            200: successResponseSchema(
                z.object({ queued: z.literal(true) }),
                "CampaignCancel",
            ),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Campaigns"],
            summary: "Queue draft campaign cancellation and budget refund",
        },
    },
);
