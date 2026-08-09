import { describe, expect, it } from "vitest";
import {
    isProofExpired,
    PURCHASE_PROOF_TYPES,
    purchaseProofDomain,
} from "../eip712";

describe("purchaseProofDomain", () => {
    it("builds the demo EIP-712 domain", () => {
        const domain = purchaseProofDomain({
            verifyingContract: "0x00000000000000000000000000000000000000fa",
            chainId: 421614,
        });
        expect(domain).toEqual({
            name: "PunchConsumption",
            version: "1",
            chainId: 421614,
            verifyingContract: "0x00000000000000000000000000000000000000fa",
        });
    });
});

describe("PURCHASE_PROOF_TYPES", () => {
    it("declares every parent-spec signed field", () => {
        expect(PURCHASE_PROOF_TYPES.PurchaseProof.map((f) => f.name)).toEqual([
            "cafeId",
            "user",
            "productId",
            "amountCentimos",
            "receiptHash",
            "nonce",
            "expiry",
            "chainId",
            "verifyingContract",
        ]);
    });
});

describe("isProofExpired", () => {
    it("is expired once now reaches expiry", () => {
        expect(isProofExpired(1000n, 1000)).toBe(true);
    });
    it("is not expired before expiry", () => {
        expect(isProofExpired(1000n, 999)).toBe(false);
    });
});
