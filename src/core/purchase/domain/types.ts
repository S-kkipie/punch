import type { z } from "zod";
import type { purchaseOrderSchema } from "./schemas";

export type PurchaseOrderStatus =
    | "user_confirmed"
    | "cafe_confirmed"
    | "queued"
    | "submitted"
    | "confirmed"
    | "failed"
    | "expired";

export type PurchaseOrderView = z.infer<typeof purchaseOrderSchema>;
