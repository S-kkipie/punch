import { z } from "zod";

export const campaignStatusSchema = z.enum([
    "available",
    "redeemed",
    "expired",
]);

export const dashboardSchema = z.object({
    balance: z.number().int().nonnegative().nullable(),
    stale: z.boolean(),
    chainMode: z.enum(["mock", "local"]),
    progress: z
        .object({
            numerator: z.number().int(),
            denominator: z.literal(12),
        })
        .nullable(),
    activeCampaign: z
        .object({ id: z.string(), name: z.string(), cafeId: z.string() })
        .nullable(),
    activeCrawl: z
        .object({
            id: z.string(),
            name: z.string(),
            completedSteps: z.number().int(),
            totalSteps: z.number().int(),
        })
        .nullable(),
});

export const campaignSchema = z.object({
    id: z.string(),
    kind: z.literal("verified_acquisition"),
    cafeId: z.string(),
    name: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    active: z.boolean(),
});

export const consumerVoucherSchema = z.object({
    id: z.string(),
    source: z.enum(["campaign", "crawl"]),
    campaignId: z.string().nullable(),
    crawlId: z.string().nullable(),
    cafeId: z.string().nullable(),
    status: campaignStatusSchema,
    expiresAt: z.string(),
    redeemedAt: z.string().nullable(),
});

export const coffeeCrawlStepSchema = z.object({
    stepIndex: z.number().int(),
    cafeId: z.string(),
});

export const coffeeCrawlSchema = z.object({
    id: z.string(),
    name: z.string(),
    expiresAt: z.string(),
    steps: z.array(coffeeCrawlStepSchema),
});
