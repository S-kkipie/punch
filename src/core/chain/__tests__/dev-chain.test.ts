import { describe, expect, it } from "vitest";
import {
    anvilDeployerAddress,
    ownerAddressForIndex,
    waitForWrite,
} from "../../../../scripts/dev-chain";

const hash =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;

describe("development chain bootstrap", () => {
    it("rejects mined reverted writes with action and transaction hash", async () => {
        const pub = {
            waitForTransactionReceipt: async () => ({ status: "reverted" }),
        } as never;

        await expect(waitForWrite(pub, hash, "register cafe")).rejects.toThrow(
            /register cafe.*reverted.*0x1234/i,
        );
    });

    it("resolves successful mined writes", async () => {
        const pub = {
            waitForTransactionReceipt: async () => ({ status: "success" }),
        } as never;

        await expect(
            waitForWrite(pub, hash, "register cafe"),
        ).resolves.toBeUndefined();
    });

    it("keeps deployment funded by Anvil while custodial owners use the app mnemonic", () => {
        expect(anvilDeployerAddress).toBe(
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        );
        expect(
            ownerAddressForIndex(
                0,
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            ),
        ).not.toBe(anvilDeployerAddress);
    });
});
