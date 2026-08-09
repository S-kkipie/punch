import { z } from "zod";
import type { CampaignParams } from "./types";

const MAX_SQL_INTEGER = 2_147_483_647;

export const createCampaignSchema: z.ZodType<CampaignParams> = z
    .object({
        name: z.string().min(1),
        windowStart: z.date(),
        windowEnd: z.date(),
        voucherPayout: z.bigint().positive(),
        maxVouchers: z.number().int().positive().max(MAX_SQL_INTEGER),
    })
    .superRefine((params, context) => {
        if (params.windowEnd < params.windowStart) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["windowEnd"],
                message: "windowEnd must be on or after windowStart",
            });
        }
    });
