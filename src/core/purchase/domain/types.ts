import type { z } from "zod";
import type { createPurchaseSchema, purchaseOrderSchema } from "./schemas";

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
