import { z } from "zod";

const bytes32Hex = z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "Hash inválido (bytes32)");

export const createPurchaseProofSchema = z.object({
    productId: z.string().min(1, "Selecciona un producto"),
    receiptHash: bytes32Hex,
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
]);

export const redemptionRequestKindSchema = z.enum(["punch_reward", "voucher"]);

export const purchaseProofStatusSchema = z.enum(["issued", "confirmed"]);

export const purchaseProofSchema = z.object({
    id: z.string(),
    cafeId: z.string(),
    productId: z.string(),
    amountCentimos: z.number().int().positive(),
    expiresAt: z.string(),
    status: purchaseProofStatusSchema,
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
    createdAt: z.string(),
});
