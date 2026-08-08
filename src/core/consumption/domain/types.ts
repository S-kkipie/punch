import type { z } from "zod";
import type {
    confirmPurchaseSchema,
    consumerTransactionSchema,
    consumerTransactionStatusSchema,
    consumptionOperationSchema,
    createPurchaseProofSchema,
    decideRedemptionRequestSchema,
    fulfillmentRequestStatusSchema,
    purchaseProofSchema,
    purchaseProofStatusSchema,
    redemptionRequestKindSchema,
    redemptionRequestSchema,
    requestPunchRedemptionSchema,
    requestVoucherRedemptionSchema,
} from "./schemas";

export type CreatePurchaseProof = z.infer<typeof createPurchaseProofSchema>;
export type ConfirmPurchase = z.infer<typeof confirmPurchaseSchema>;
export type PurchaseProofStatus = z.infer<typeof purchaseProofStatusSchema>;
export type PurchaseProof = z.infer<typeof purchaseProofSchema>;
export type ConsumptionOperation = z.infer<typeof consumptionOperationSchema>;
export type ConsumerTransactionStatus = z.infer<
    typeof consumerTransactionStatusSchema
>;
export type ConsumerTransaction = z.infer<typeof consumerTransactionSchema>;
export type FulfillmentRequestStatus = z.infer<
    typeof fulfillmentRequestStatusSchema
>;
export type RedemptionRequestKind = z.infer<typeof redemptionRequestKindSchema>;
export type RequestPunchRedemption = z.infer<
    typeof requestPunchRedemptionSchema
>;
export type RequestVoucherRedemption = z.infer<
    typeof requestVoucherRedemptionSchema
>;
export type DecideRedemptionRequest = z.infer<
    typeof decideRedemptionRequestSchema
>;
export type RedemptionRequest = z.infer<typeof redemptionRequestSchema>;
