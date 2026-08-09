import type { z } from "zod";
import type {
    campaignSchema,
    campaignStatusSchema,
    coffeeCrawlSchema,
    coffeeCrawlStepSchema,
    consumerVoucherSchema,
    dashboardSchema,
} from "./schemas";

export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Campaign = z.infer<typeof campaignSchema>;
export type ConsumerVoucher = z.infer<typeof consumerVoucherSchema>;
export type CoffeeCrawlStep = z.infer<typeof coffeeCrawlStepSchema>;
export type CoffeeCrawl = z.infer<typeof coffeeCrawlSchema>;
