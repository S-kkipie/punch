import type { PlanOrderStatus } from "./types";

const edges: Record<PlanOrderStatus, PlanOrderStatus[]> = {
    // pending → confirmed is the lost-receipt recovery: the tx landed but the
    // write that recorded it did not.
    pending: ["submitted", "confirmed", "failed"],
    // submitted → pending is the expired-lease recovery.
    submitted: ["confirmed", "failed", "pending"],
    confirmed: [],
    failed: [],
};

export function canTransition(
    from: PlanOrderStatus,
    to: PlanOrderStatus,
): boolean {
    return edges[from].includes(to);
}

export function isTerminal(status: PlanOrderStatus): boolean {
    return edges[status].length === 0;
}
