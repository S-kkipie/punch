import { decodeErrorResult, type Abi, type Hex } from "viem";
import { abis } from "@/core/chain/abis";

export type RevertCode =
    | "nonce_used"
    | "receipt_used"
    | "daily_limit"
    | "no_credits"
    | "expired"
    | "ticket_too_small"
    | "product_not_eligible"
    | "invalid_signature"
    | "unknown";

export type ParsedRevert = { code: RevertCode; message: string };

const errorAbis = [...abis.consumptionLog, ...abis.planManager] as Abi;
const errorNames: Record<string, RevertCode> = {
    NonceUsed: "nonce_used",
    ReceiptUsed: "receipt_used",
    DailyLimitReached: "daily_limit",
    NoCredits: "no_credits",
    ProofExpired: "expired",
    TicketTooSmall: "ticket_too_small",
    ProductNotEligible: "product_not_eligible",
    InvalidCafeSignature: "invalid_signature",
    InvalidUserSignature: "invalid_signature",
};

function findData(error: unknown): Hex | undefined {
    if (!error || typeof error !== "object") return undefined;
    const value = error as Record<string, unknown>;
    for (const key of ["data", "raw"]) {
        if (typeof value[key] === "string" && (value[key] as string).startsWith("0x")) {
            return value[key] as Hex;
        }
    }
    return findData(value.cause);
}

export function parseRevert(error: unknown): ParsedRevert {
    const data = findData(error);
    if (data) {
        try {
            const decoded = decodeErrorResult({ abi: errorAbis, data });
            const code = errorNames[decoded.errorName];
            if (code) return { code, message: code };
        } catch {
            // Unknown or malformed revert data is intentionally sanitized below.
        }
    }
    return { code: "unknown", message: "unknown chain or network error" };
}
