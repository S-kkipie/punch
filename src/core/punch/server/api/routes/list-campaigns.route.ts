import { Elysia } from "elysia";
import { campaignSchema } from "@/core/punch/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listCampaignsService } from "../../services/list-campaigns-service";

export const listCampaignsRoute = new Elysia().use(authed).get(
    "/campaigns",
    async ({ status }) => {
        const result = await listCampaignsService();
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
            200: successResponseSchema(campaignSchema.array(), "Campaigns"),
            401: errorResponseSchema(401),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Punch"], summary: "Listar campañas" },
    },
);
