import { hashTypedData, recoverTypedDataAddress } from "viem";
import { describe, expect, it } from "vitest";
import { deriveAccount } from "../../wallet/derive";
import {
    buildReceiptHash,
    configuredProofDomain,
    deserializeProof,
    type ProofDomainContext,
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

    it("uses explicit verifying contracts in the typed-data domain", () => {
        const contextA: ProofDomainContext = {
            chainId: 31337,
            verifyingContract: "0x1111111111111111111111111111111111111111",
        };
        const contextB: ProofDomainContext = {
            ...contextA,
            verifyingContract: "0x2222222222222222222222222222222222222222",
        };

        expect(hashTypedData(proofTypedData(proof, contextA))).not.toBe(
            hashTypedData(proofTypedData(proof, contextB)),
        );
        expect(proofTypedData(proof, contextA).domain.verifyingContract).toBe(
            contextA.verifyingContract,
        );
    });

    it("uses explicit chain IDs in the typed-data domain", () => {
        const contextA: ProofDomainContext = {
            chainId: 31337,
            verifyingContract: "0x1111111111111111111111111111111111111111",
        };
        const contextB: ProofDomainContext = { ...contextA, chainId: 31338 };

        expect(hashTypedData(proofTypedData(proof, contextA))).not.toBe(
            hashTypedData(proofTypedData(proof, contextB)),
        );
    });

    it("signProofAs passes explicit domain context through", async () => {
        const context: ProofDomainContext = {
            chainId: 31337,
            verifyingContract: "0x3333333333333333333333333333333333333333",
        };
        const signature = await signProofAs(5, proof, context);
        const recovered = await recoverTypedDataAddress({
            ...proofTypedData(proof, context),
            signature,
        });

        expect(recovered).toBe(deriveAccount(MNEMONIC, 5).address);
    });

    it.each([
        ["zero chain ID", { chainId: 0 }, "chainId"],
        ["fractional chain ID", { chainId: 1.5 }, "chainId"],
        [
            "unsafe chain ID",
            { chainId: Number.MAX_SAFE_INTEGER + 1 },
            "chainId",
        ],
        [
            "invalid contract",
            { chainId: 1, verifyingContract: "0x1234" },
            "verifyingContract",
        ],
    ])("rejects invalid proof domain: %s", (_case, context, field) => {
        expect(() =>
            proofTypedData(proof, context as ProofDomainContext),
        ).toThrow(field);
    });

    it("omitted context uses the configured proof domain", () => {
        const configured = configuredProofDomain();
        expect(proofTypedData(proof).domain).toMatchObject(configured);
    });

    it("accepts a positive safe integer chain ID", () => {
        expect(
            proofTypedData(proof, {
                chainId: 1,
                verifyingContract: "0x4444444444444444444444444444444444444444",
            }).domain.chainId,
        ).toBe(1);
    });

    it("rejects a non-integer contract context", () => {
        expect(() =>
            proofTypedData(proof, {
                chainId: Number.NaN,
                verifyingContract: "0x4444444444444444444444444444444444444444",
            }),
        ).toThrow("chainId");
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
