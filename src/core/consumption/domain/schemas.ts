import { z } from "zod";

export const createPurchaseProofSchema = z.object({
    productId: z.string().uuid(),
    yapeRef: z.string().trim().min(4).max(120),
});

export const confirmPurchaseSchema = z.object({
    proofId: z.string().min(1, "Indica el comprobante de compra"),
});

export const consumerTransactionStatusSchema = z.enum([
    "pending",
    "confirmed",
    "rejected",
    "failed",
]);

export const consumptionOperationSchema = z.enum([
    "emission",
    "punch_redemption",
    "voucher_redemption",
]);

export const fulfillmentRequestStatusSchema = z.enum([
    "pending",
    "approved",
    "rejected",
    "confirmed",
    "failed",
]);

export const redemptionRequestKindSchema = z.enum(["punch_reward", "voucher"]);

export const purchaseProofStatusValues = [
    "issued",
    "submitted",
    "confirmed",
    "failed",
    "expired",
] as const;

export const purchaseProofStatusSchema = z.enum(purchaseProofStatusValues);

export const purchaseProofSchema = z.object({
    id: z.string(),
    cafeId: z.string(),
    productId: z.string(),
    amountCentimos: z.number().int().positive(),
    expiresAt: z.string(),
    status: purchaseProofStatusSchema,
    maskedYapeRef: z.string(),
    purchaseOrderId: z.string().nullable(),
    failureReason: z.string().nullable(),
    createdAt: z.string(),
});

export const consumerTransactionSchema = z.object({
    id: z.string(),
    operation: consumptionOperationSchema,
    cafeId: z.string(),
    status: consumerTransactionStatusSchema,
    rejectionReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const requestPunchRedemptionSchema = z.object({
    productId: z.string().min(1, "Selecciona un producto"),
});

export const requestVoucherRedemptionSchema = z.object({
    voucherId: z.string().min(1, "Indica el voucher a canjear"),
});

export const decideRedemptionRequestSchema = z
    .object({
        decision: z.enum(["approved", "rejected"]),
        rejectionReason: z.string().trim().max(500).optional(),
    })
    .refine((r) => r.decision !== "rejected" || !!r.rejectionReason, {
        message: "Un rechazo debe incluir una razón accionable",
        path: ["rejectionReason"],
    });

export const redemptionRequestSchema = z.object({
    id: z.string(),
    kind: redemptionRequestKindSchema,
    cafeId: z.string(),
    productId: z.string().nullable(),
    voucherId: z.string().nullable(),
    status: fulfillmentRequestStatusSchema,
    rejectionReason: z.string().nullable(),
    failureReason: z.string().nullable().optional(),
    /** Solo lo devuelve la bandeja de la cafetería, para identificar al cliente. */
    consumerName: z.string().nullable().optional(),
    createdAt: z.string(),
    transactionId: z.string().nullable().optional(),
    transactionStatus: consumerTransactionStatusSchema.nullable().optional(),
    transactionFailureReason: z.string().nullable().optional(),
});
