import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { PURCHASE_PROOF_TYPES, purchaseProofDomain } from "../../domain/eip712";
import { DEMO_CONSUMPTION_VERIFIER_ADDRESS } from "../demo-chain-context";

describe("demo signing context", () => {
    it("accepts the canonical verifier address in real viem signing", async () => {
        const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
        const signature = await account.signTypedData({
            domain: purchaseProofDomain({
                verifyingContract: DEMO_CONSUMPTION_VERIFIER_ADDRESS,
                chainId: 421614,
            }),
            types: PURCHASE_PROOF_TYPES,
            primaryType: "PurchaseProof",
            message: {
                cafeId: "cafe-1",
                user: account.address,
                productId: "product-1",
                amountCentimos: 800n,
                receiptHash: `0x${"22".repeat(32)}`,
                nonce: `0x${"33".repeat(32)}`,
                expiry: 1_800_000_000n,
                chainId: 421614n,
                verifyingContract: DEMO_CONSUMPTION_VERIFIER_ADDRESS,
            },
        });
        expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    });
});
