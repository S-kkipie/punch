import { ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";
import { abis } from "@/core/chain/abis";
import { parseRevert } from "../parse-revert";

const cases = [
    ["NonceUsed", [1n, 2n], "nonce_used"],
    ["ReceiptUsed", [1n, `0x${"11".repeat(32)}`], "receipt_used"],
    ["DailyLimitReached", [1n, "0x0000000000000000000000000000000000000001"], "daily_limit"],
    ["NoCredits", [1n], "no_credits"],
    ["ProofExpired", [1n], "expired"],
    ["TicketTooSmall", [1n], "ticket_too_small"],
    ["ProductNotEligible", [1n, 2n], "product_not_eligible"],
    ["InvalidCafeSignature", [], "invalid_signature"],
    ["InvalidUserSignature", [], "invalid_signature"],
] as const;

describe("parseRevert", () => {
    it.each(cases)("maps %s", (errorName, args, code) => {
        const abi = errorName === "NoCredits" ? abis.planManager : abis.consumptionLog;
        const data = (encodeErrorResult as any)({ abi, errorName, args });
        const error = new ContractFunctionRevertedError({
            abi,
            data,
            functionName: "recordConsumption",
        });
        expect(parseRevert({ cause: error })).toEqual({ code, message: code });
    });

    it("sanitizes unknown and malformed errors", () => {
        expect(parseRevert(new Error("secret payload 0xdeadbeef"))).toEqual({
            code: "unknown",
            message: "unknown chain or network error",
        });
        expect(parseRevert({ cause: { data: "0x1234" } }).code).toBe("unknown");
    });
});
