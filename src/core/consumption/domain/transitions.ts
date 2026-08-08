export type ConsumerTransactionStatus =
    | "pending"
    | "confirmed"
    | "rejected"
    | "failed";

const ALLOWED_TX: Record<
    ConsumerTransactionStatus,
    ConsumerTransactionStatus[]
> = {
    pending: ["confirmed", "rejected", "failed"],
    confirmed: [],
    rejected: [],
    failed: ["pending"],
};

export function canTransitionTransaction(
    from: ConsumerTransactionStatus,
    to: ConsumerTransactionStatus,
): boolean {
    return ALLOWED_TX[from].includes(to);
}

export type FulfillmentRequestStatus = "pending" | "approved" | "rejected";

const ALLOWED_FULFILLMENT: Record<
    FulfillmentRequestStatus,
    FulfillmentRequestStatus[]
> = {
    pending: ["approved", "rejected"],
    approved: [],
    rejected: [],
};

export function canTransitionFulfillment(
    from: FulfillmentRequestStatus,
    to: FulfillmentRequestStatus,
): boolean {
    return ALLOWED_FULFILLMENT[from].includes(to);
}
