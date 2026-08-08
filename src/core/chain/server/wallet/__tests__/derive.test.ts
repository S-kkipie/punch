import { describe, expect, it } from "vitest";
import { deriveAccount } from "../derive";

// Well-known BIP-39 test phrase (hardhat/foundry default) with published
// derived addresses — deterministic fixture, never used with real funds.
const TEST_MNEMONIC =
    "test test test test test test test test test test test junk";

describe("deriveAccount", () => {
    it("derives the canonical address for index 0", () => {
        const account = deriveAccount(TEST_MNEMONIC, 0);
        expect(account.address).toBe(
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        );
    });

    it("derives the canonical address for index 1", () => {
        const account = deriveAccount(TEST_MNEMONIC, 1);
        expect(account.address).toBe(
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        );
    });

    it("is deterministic: same index → same address", () => {
        expect(deriveAccount(TEST_MNEMONIC, 7).address).toBe(
            deriveAccount(TEST_MNEMONIC, 7).address,
        );
    });

    it("different indexes → different addresses", () => {
        expect(deriveAccount(TEST_MNEMONIC, 2).address).not.toBe(
            deriveAccount(TEST_MNEMONIC, 3).address,
        );
    });

    it("can sign EIP-712 typed data", async () => {
        const account = deriveAccount(TEST_MNEMONIC, 0);
        const signature = await account.signTypedData({
            domain: { name: "PunchTest", version: "1", chainId: 421614 },
            types: { Ping: [{ name: "nonce", type: "uint256" }] },
            primaryType: "Ping",
            message: { nonce: 1n },
        });
        expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    });
});
