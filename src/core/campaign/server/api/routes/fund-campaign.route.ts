import { Elysia } from "elysia";
import { z } from "zod";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    createdResponseSchema,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { fundCampaignService } from "../../services/fund-campaign-service";

const positiveIntegerString = z
    .string()
    .regex(/^\d+$/, "Monto inválido")
    .refine((value) => BigInt(value) > 0n, "El monto debe ser mayor a 0")
    .transform((value) => BigInt(value));

export const fundCampaignRoute = new Elysia().use(authed).post(
    "/cafe/:cafeId/campaigns/:campaignId/fund",
    async ({ user, params, body, status }) => {
        const result = await fundCampaignService(
            user.id,
            params.cafeId,
            params.campaignId,
            body.amount,
        );
        if (!result.ok)
            return status(
                result.error.status as 400 | 403 | 404 | 409 | 500,
                errorToResponse(result.error),
            );
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        params: z.object({
            cafeId: z.string().min(1),
            campaignId: z.string().min(1),
        }),
        body: z.object({ amount: positiveIntegerString }),
        response: {
            201: createdResponseSchema(
                z.object({ fundingId: z.string() }),
                "CampaignFunding",
            ),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Campaigns"], summary: "Queue café campaign funding" },
    },
);
