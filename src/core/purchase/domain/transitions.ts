import type { PurchaseOrderStatus } from "./types";

const edges: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
    user_confirmed: ["cafe_confirmed", "expired"],
    cafe_confirmed: ["queued", "expired"],
    // queued → confirmed is the "nonce already used" recovery: the tx landed
    // via a previous attempt whose receipt write was lost.
    queued: ["submitted", "failed", "confirmed"],
    submitted: ["confirmed", "failed"],
    confirmed: [],
    failed: [],
    expired: [],
};

export function canTransition(
    from: PurchaseOrderStatus,
    to: PurchaseOrderStatus,
): boolean {
    return edges[from].includes(to);
}
