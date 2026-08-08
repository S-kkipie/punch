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
});
