import { type Abi, decodeErrorResult, type Hex } from "viem";
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
    | "not_draft"
    | "not_published"
    | "campaign_not_found"
    | "campaign_expired"
    | "max_vouchers_reached"
    | "insufficient_budget"
    | "insufficient_free_balance"
    | "expiry_in_past"
    | "zero_amount"
    | "cafe_not_operational"
    | "voucher_not_unlocked"
    | "voucher_already_unlocked"
    | "voucher_already_redeemed"
    | "not_campaign_operator"
    | "not_owner"
    | "paused"
    | "unknown";

export type ParsedRevert = { code: RevertCode; message: string };

const errorAbis = [
    ...abis.consumptionLog,
    ...abis.planManager,
    ...abis.campaignEscrow,
] as Abi;
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
    NotDraft: "not_draft",
    NotPublished: "not_published",
    CampaignNotFound: "campaign_not_found",
    CampaignExpired: "campaign_expired",
    MaxVouchersReached: "max_vouchers_reached",
    InsufficientBudget: "insufficient_budget",
    InsufficientFreeBalance: "insufficient_free_balance",
    ExpiryInPast: "expiry_in_past",
    ZeroAmount: "zero_amount",
    CafeNotOperational: "cafe_not_operational",
    VoucherNotUnlocked: "voucher_not_unlocked",
    VoucherAlreadyUnlocked: "voucher_already_unlocked",
    VoucherAlreadyRedeemed: "voucher_already_redeemed",
    NotCampaignOperator: "not_campaign_operator",
    OwnableUnauthorizedAccount: "not_owner",
    EnforcedPause: "paused",
};

function findData(error: unknown): Hex | undefined {
    if (!error || typeof error !== "object") return undefined;
    const value = error as Record<string, unknown>;
    for (const key of ["data", "raw"]) {
        if (
            typeof value[key] === "string" &&
            (value[key] as string).startsWith("0x")
        ) {
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
