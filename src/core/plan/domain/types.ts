export type PlanOrderKind = "plan" | "pack";

export type PlanOrderStatus = "pending" | "submitted" | "confirmed" | "failed";

export type PlanFailureReason =
    | "not_authorized"
    | "cafe_not_operational"
    | "plan_not_active"
    | "faucet_cap_exceeded"
    | "funding_unavailable"
    | "max_attempts"
    | "reverted";

import type { z } from "zod";
import type {
    createPlanOrderSchema,
    planOrderSchema,
    planStatusSchema,
} from "./schemas";

export type CreatePlanOrder = z.infer<typeof createPlanOrderSchema>;
export type PlanOrderView = z.infer<typeof planOrderSchema>;
export type PlanStatusView = z.infer<typeof planStatusSchema>;
