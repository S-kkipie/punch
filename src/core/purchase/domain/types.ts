import type { z } from "zod";
import type { PurchaseQuoteView } from "@/core/consumption/domain/types";
import type {
    createPurchaseSchema,
    purchaseOrderSchema,
    quoteBridgeOutcomeSchema,
} from "./schemas";

export type PurchaseOrderStatus =
    | "user_confirmed"
    | "cafe_confirmed"
    | "queued"
    | "submitted"
    | "confirmed"
    | "failed"
    | "expired";

export type CreatePurchase = z.infer<typeof createPurchaseSchema>;
export type PurchaseOrderView = z.infer<typeof purchaseOrderSchema>;
export type QuoteBridgeOutcome = z.infer<typeof quoteBridgeOutcomeSchema>;
export type QuoteBridgeResult = {
    order: PurchaseOrderView;
    quote: PurchaseQuoteView;
    outcome: QuoteBridgeOutcome;
};
