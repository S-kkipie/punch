import { Elysia } from "elysia";
import { z } from "zod";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { publishCampaignService } from "../../services/publish-campaign-service";

export const publishCampaignRoute = new Elysia().use(authed).post(
    "/cafe/:cafeId/campaigns/:campaignId/publish",
    async ({ user, params, status }) => {
        const result = await publishCampaignService(
            user.id,
            params.cafeId,
            params.campaignId,
        );
        if (!result.ok)
            return status(
                result.error.status as 403 | 404 | 409 | 422 | 500,
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
                "CampaignPublish",
            ),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Campaigns"],
            summary: "Queue café campaign publishing",
        },
    },
);
