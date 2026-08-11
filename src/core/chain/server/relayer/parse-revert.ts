import { decodeErrorResult, type Hex } from "viem";
import { abis } from "@/core/chain/abis";

export type RevertCode = "nonce_used" | "receipt_used" | "daily_limit" | "no_credits" | "expired" | "ticket_too_small" | "product_not_eligible" | "invalid_signature" | "unknown";
export type ParsedRevert = { code: RevertCode; message: string };

const ERROR_MESSAGES: Record<Exclude<RevertCode, "unknown">, string> = {
    nonce_used: "nonce already used", receipt_used: "receipt already used", daily_limit: "daily limit reached",
    no_credits: "café has no credits", expired: "proof expired", ticket_too_small: "ticket is too small",
    product_not_eligible: "product is not eligible", invalid_signature: "invalid proof signature",
};
const CODE_BY_ERROR: Record<string, Exclude<RevertCode, "unknown">> = {
    NonceUsed: "nonce_used", ReceiptUsed: "receipt_used", DailyLimitReached: "daily_limit", NoCredits: "no_credits",
    ProofExpired: "expired", TicketTooSmall: "ticket_too_small", ProductNotEligible: "product_not_eligible",
    InvalidCafeSignature: "invalid_signature", InvalidUserSignature: "invalid_signature",
};

function findHex(value: unknown, seen = new Set<object>()): Hex | undefined {
    if (typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)) return value as Hex;
    if (value === null || typeof value !== "object" || seen.has(value)) return undefined;
    seen.add(value);
    for (const key of ["data", "raw", "cause", "details"]) {
        const found = findHex((value as Record<string, unknown>)[key], seen);
        if (found) return found;
    }
    return undefined;
}
function safeMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message.replace(/0x[0-9a-f]{16,}/gi, "[redacted]").slice(0, 240);
    return "transaction reverted";
}

export function parseRevert(error: unknown): ParsedRevert {
    const directName = (error as { data?: { errorName?: unknown } })?.data?.errorName;
    const data = findHex(error);
    let errorName = typeof directName === "string" ? directName : undefined;
    if (!errorName && data) {
        try { errorName = decodeErrorResult({ abi: abis.consumptionLog, data }).errorName; } catch { /* retry unknown data */ }
    }
    const code = errorName ? CODE_BY_ERROR[errorName] : undefined;
    return code ? { code, message: ERROR_MESSAGES[code] } : { code: "unknown", message: safeMessage(error) };
}
