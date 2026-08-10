import type { PlanFailureReason } from "./types";

export const MAX_PLAN_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

const permanentMarkers: [string, PlanFailureReason][] = [
    ["NotAuthorizedForCafe", "not_authorized"],
    ["CafeNotOperational", "cafe_not_operational"],
    ["PlanNotActive", "plan_not_active"],
    ["FaucetCapExceeded", "faucet_cap_exceeded"],
    ["funding_unavailable", "funding_unavailable"],
];

export type PlanErrorClass = {
    permanent: boolean;
    reason: PlanFailureReason | null;
};

/**
 * Contract reverts that will fail again on every retry are permanent; anything
 * else (RPC, nonce, timeouts) gets another attempt.
 */
export function classifyPlanError(error: unknown): PlanErrorClass {
    const text =
        error instanceof Error ? `${error.message}` : String(error ?? "");
    for (const [marker, reason] of permanentMarkers) {
        if (text.includes(marker)) return { permanent: true, reason };
    }
    return { permanent: false, reason: null };
}

export function backoffMs(attempts: number): number {
    const delay = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts);
    return Math.min(delay, MAX_BACKOFF_MS);
}
