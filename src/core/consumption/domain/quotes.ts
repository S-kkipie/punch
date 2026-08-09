import type { purchaseProofStatusValues } from "./schemas";

export type PurchaseQuoteStatus = (typeof purchaseProofStatusValues)[number];

export function maskYapeRef(value: string): string {
    const visible = value.slice(-2);
    return `${"•".repeat(Math.max(0, value.length - visible.length))}${visible}`;
}
