export const purchaseQuoteStatuses = [
    "issued",
    "submitted",
    "confirmed",
    "failed",
    "expired",
] as const;

export type PurchaseQuoteStatus = (typeof purchaseQuoteStatuses)[number];

export function maskYapeRef(value: string): string {
    const visible = value.slice(-2);
    return `${"•".repeat(Math.max(0, value.length - visible.length))}${visible}`;
}
