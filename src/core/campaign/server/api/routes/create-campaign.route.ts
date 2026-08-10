import { Elysia } from "elysia";
import { z } from "zod";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    createdResponseSchema,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { createCampaignService } from "../../services/create-campaign-service";

const positiveIntegerString = z
    .string()
    .regex(/^\d+$/, "Monto inválido")
    .refine((value) => BigInt(value) > 0n, "El monto debe ser mayor a 0");

export const createCampaignBodySchema = z
    .object({
        name: z.string().trim().min(1),
        windowStart: z
            .string()
            .datetime({ offset: true })
            .transform((value) => new Date(value)),
        windowEnd: z
            .string()
            .datetime({ offset: true })
            .transform((value) => new Date(value)),
        voucherPayout: positiveIntegerString.transform((value) =>
            BigInt(value),
        ),
        maxVouchers: z.number().int().positive().safe(),
    })
    .superRefine((body, context) => {
        if (body.windowEnd < body.windowStart) {
            context.addIssue({
                code: "custom",
                path: ["windowEnd"],
                message: "windowEnd must be on or after windowStart",
            });
        }
    });

export const createCampaignRoute = new Elysia().use(authed).post(
    "/cafe/:cafeId/campaigns",
    async ({ user, params, body, status }) => {
        const result = await createCampaignService(
            user.id,
            params.cafeId,
            body,
        );
        if (!result.ok)
            return status(
                result.error.status as 400 | 403 | 404 | 500,
                errorToResponse(result.error),
            );
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        params: z.object({ cafeId: z.string().min(1) }),
        body: createCampaignBodySchema,
        response: {
            201: createdResponseSchema(
                z.object({ campaignId: z.string() }),
                "CampaignCreated",
            ),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Campaigns"], summary: "Create a café campaign" },
    },
);
