import { hashTypedData, recoverTypedDataAddress } from "viem";
import { describe, expect, it } from "vitest";
import { deriveAccount } from "../../wallet/derive";
import {
    buildReceiptHash,
    deserializeProof,
    proofTypedData,
    randomNonce,
    serializeProof,
    signProofAs,
} from "../proof";

const MNEMONIC = "test test test test test test test test test test test junk";

const proof = {
    cafeId: 1n,
    user: deriveAccount(MNEMONIC, 5).address,
    productId: 1n,
    amount: 8_500_000n,
    receiptHash: buildReceiptHash("order-1", "yape-op-777"),
    nonce: 123456789n,
    expiry: 1_900_000_000n,
};

describe("proof module", () => {
    it("receipt hash is deterministic and salted by order", () => {
        expect(buildReceiptHash("a", "ref")).toBe(buildReceiptHash("a", "ref"));
        expect(buildReceiptHash("a", "ref")).not.toBe(
            buildReceiptHash("b", "ref"),
        );
    });

    it("randomNonce returns distinct uint256 values", () => {
        const a = randomNonce();
        const b = randomNonce();
        expect(a).not.toBe(b);
        expect(a).toBeLessThan(2n ** 256n);
        expect(a).toBeGreaterThanOrEqual(0n);
    });

    it("signProofAs signs typed data recoverable to the derived address", async () => {
        const signature = await signProofAs(5, proof);
        const recovered = await recoverTypedDataAddress({
            ...proofTypedData(proof),
            signature,
        });
        expect(recovered).toBe(deriveAccount(MNEMONIC, 5).address);
    });

    it("serialize/deserialize round-trips bigints", () => {
        expect(deserializeProof(serializeProof(proof))).toEqual(proof);
    });

    it("typed digest is stable and changes when a signed field changes", () => {
        const digest = hashTypedData(proofTypedData(proof));
        const sameDigest = hashTypedData(proofTypedData(proof));
        const changedDigest = hashTypedData(
            proofTypedData({ ...proof, amount: proof.amount + 1n }),
        );

        expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
        expect(sameDigest).toBe(digest);
        expect(changedDigest).not.toBe(digest);
    });

    const invalidCases: Array<[string, Record<string, unknown>, string]> = [
        ["short user", { user: "0x1234" }, "user"],
        [
            "nonhex user",
            { user: "0xgg000000000000000000000000000000000000" },
            "user",
        ],
        [
            "21-byte user",
            { user: "0x000000000000000000000000000000000000000001" },
            "user",
        ],
        ["short receipt hash", { receiptHash: "0x12" }, "receiptHash"],
        ["negative nonce", { nonce: "-1" }, "nonce"],
        ["decimal amount", { amount: "1.5" }, "amount"],
        ["uint256 overflow", { expiry: (2n ** 256n).toString() }, "expiry"],
        ["missing field", {}, "proof"],
    ];

    it.each(invalidCases)("rejects %s from JSONB", (_case, override, field) => {
        const serialized = serializeProof(proof) as Record<string, unknown>;
        Object.assign(serialized, override);
        if (_case === "missing field") delete serialized.amount;

        expect(() => deserializeProof(serialized)).toThrow(field);
    });

    it.each([
        null,
        "proof",
        42,
        [],
    ])("rejects non-object payload %p", (payload) => {
        expect(() => deserializeProof(payload)).toThrow("proof");
    });

    it.each([
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        "0xAbcdefabcdefabcdefabcdefabcdefabcdefabcd",
    ])("accepts byte-valid address %s without checksum enforcement", (user) => {
        const serialized = { ...serializeProof(proof), user };

        expect(deserializeProof(serialized).user).toBe(user);
    });

    it("accepts zero and maximum uint256 values", () => {
        const max = (2n ** 256n - 1n).toString();
        const serialized = {
            ...serializeProof(proof),
            cafeId: "0",
            productId: max,
            amount: "0",
            nonce: max,
            expiry: "0",
        };

        expect(deserializeProof(serialized)).toEqual({
            ...proof,
            cafeId: 0n,
            productId: 2n ** 256n - 1n,
            amount: 0n,
            nonce: 2n ** 256n - 1n,
            expiry: 0n,
        });
    });
});
