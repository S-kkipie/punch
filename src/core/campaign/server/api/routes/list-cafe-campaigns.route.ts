import { Elysia } from "elysia";
import { z } from "zod";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listCafeCampaignsService } from "../../services/list-cafe-campaigns-service";

export const cafeCampaignSchema = z.object({
    id: z.string(),
    cafeId: z.string(),
    name: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    voucherPayout: z.string(),
    maxVouchers: z.number().int().positive(),
    lifecycle: z.enum(["creating", "draft", "published", "cancelled"]),
    required: z.string(),
    funded: z.string(),
    missing: z.string(),
    canPublish: z.boolean(),
    chainOps: z
        .object({
            kind: z.string(),
            status: z.enum(["pending", "submitted", "confirmed", "failed"]),
            txHash: z.string().nullable(),
            error: z.string().nullable(),
            createdAt: z.string(),
        })
        .array(),
});

export const listCafeCampaignsRoute = new Elysia().use(authed).get(
    "/cafe/:cafeId/campaigns",
    async ({ user, params, status }) => {
        const result = await listCafeCampaignsService(user.id, params.cafeId);
        if (!result.ok)
            return status(
                result.error.status as 403 | 404 | 409 | 500,
                errorToResponse(result.error),
            );
        return status(
            200,
            CommonResponse.successful({
                response: {
                    campaigns: result.data.campaigns.map((campaign) => ({
                        ...campaign,
                        windowStart: campaign.windowStart.toISOString(),
                        windowEnd: campaign.windowEnd.toISOString(),
                        voucherPayout: campaign.voucherPayout.toString(),
                        required: campaign.required.toString(),
                        funded: campaign.funded.toString(),
                        missing: campaign.missing.toString(),
                        chainOps: campaign.chainOps.map((op) => ({
                            ...op,
                            createdAt: op.createdAt.toISOString(),
                        })),
                    })),
                    walletBalance: result.data.walletBalance.toString(),
                },
            }),
        );
    },
    {
        authed: true,
        params: z.object({ cafeId: z.string().min(1) }),
        response: {
            200: successResponseSchema(
                z.object({
                    campaigns: cafeCampaignSchema.array(),
                    walletBalance: z.string(),
                }),
                "CafeCampaigns",
            ),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Campaigns"], summary: "List café campaigns" },
    },
);
