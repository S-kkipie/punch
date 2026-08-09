import { describe, expect, it } from "vitest";
import { generateNonce, toNonceHex } from "../nonce";

describe("toNonceHex", () => {
    it("hex-encodes 32 bytes with 0x prefix", () => {
        const bytes = new Uint8Array(32).fill(1);
        expect(toNonceHex(bytes)).toBe(`0x${"01".repeat(32)}`);
    });
    it("rejects a non-32-byte input", () => {
        expect(() => toNonceHex(new Uint8Array(31))).toThrow(
            "nonce must be 32 bytes",
        );
    });
});

describe("generateNonce", () => {
    it("produces a well-formed bytes32 hex nonce", () => {
        expect(generateNonce()).toMatch(/^0x[0-9a-f]{64}$/);
    });
    it("is unpredictable across calls", () => {
        expect(generateNonce()).not.toBe(generateNonce());
    });
});
