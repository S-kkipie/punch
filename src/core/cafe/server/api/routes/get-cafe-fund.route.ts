import { Elysia } from "elysia";
import { z } from "zod";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { getCafeFundService } from "../../services/get-cafe-fund-service";

export const cafeFundSchema = z.object({
    epoch: z.number().int().positive(),
    referrals: z.number().int().nonnegative(),
    pendingCreditMpen: z.string(),
    estimated: z.boolean(),
    buckets: z.object({
        origin: z.string(),
        acquisition: z.string(),
        crawl: z.string(),
        contingency: z.string(),
    }),
});

export const getCafeFundRoute = new Elysia().use(authed).get(
    "/cafe/:cafeId/fund",
    async ({ user, params, status }) => {
        const result = await getCafeFundService(user.id, params.cafeId);
        if (!result.ok)
            return status(
                result.error.status as 403 | 409 | 500,
                errorToResponse(result.error),
            );
        return status(
            200,
            CommonResponse.successful({
                response: {
                    ...result.data,
                    pendingCreditMpen: result.data.pendingCreditMpen.toString(),
                    buckets: {
                        origin: result.data.buckets.origin.toString(),
                        acquisition: result.data.buckets.acquisition.toString(),
                        crawl: result.data.buckets.crawl.toString(),
                        contingency: result.data.buckets.contingency.toString(),
                    },
                },
            }),
        );
    },
    {
        authed: true,
        params: z.object({ cafeId: z.string().min(1) }),
        response: {
            200: successResponseSchema(cafeFundSchema, "CafeFund"),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "Get café common fund" },
    },
);
