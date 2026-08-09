import { z } from "zod";

export const purchaseOrderStatusValues = [
    "user_confirmed",
    "cafe_confirmed",
    "queued",
    "submitted",
    "confirmed",
    "failed",
    "expired",
] as const;

export const purchaseOrderStatusSchema = z.enum(purchaseOrderStatusValues);

const amountSolesSchema = z
    .number()
    .positive()
    .refine((amount) => Number.isFinite(amount), "amount must be finite")
    .refine(
        (amount) => Math.abs(amount * 100 - Math.round(amount * 100)) <= 1e-6,
        "amount has more than 2 decimals",
    );

export const createPurchaseSchema = z.object({
    cafeId: z.string().min(1),
    productId: z.string().min(1),
    amountSoles: amountSolesSchema,
    yapeRef: z.string().min(4).max(120),
});

export const quoteBridgeOutcomeSchema = z.enum(["created", "existing"]);

export const purchaseOrderSchema = z.object({
    id: z.string(),
    cafeId: z.string(),
    productId: z.string(),
    amountSoles: amountSolesSchema,
    status: purchaseOrderStatusSchema,
    failureReason: z.string().nullable(),
    txHash: z.string().nullable(),
    expiry: z.iso.datetime(),
    createdAt: z.iso.datetime(),
});

export function solesToMpen(amountSoles: number): bigint {
    if (!Number.isFinite(amountSoles) || amountSoles <= 0) {
        throw new Error("amount must be positive");
    }

    const centavos = Math.round(amountSoles * 100);
    if (Math.abs(amountSoles * 100 - centavos) > 1e-6) {
        throw new Error("amount has more than 2 decimals");
    }

    return BigInt(centavos) * 10_000n;
}
