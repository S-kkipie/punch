import { Elysia, t } from "elysia";
import { campaignSchema } from "@/core/punch/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { getCampaignService } from "../../services/list-campaigns-service";

export const getCampaignRoute = new Elysia().use(authed).get(
    "/campaigns/:id",
    async ({ params, status }) => {
        const result = await getCampaignService(params.id);
        if (!result.ok)
            return status(
                result.error.status as 404,
                errorToResponse(result.error),
            );
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        params: t.Object({ id: t.String() }),
        response: {
            200: successResponseSchema(campaignSchema, "Campaign"),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Punch"], summary: "Consultar campaña" },
    },
);
