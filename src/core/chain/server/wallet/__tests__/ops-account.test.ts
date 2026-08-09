import { describe, expect, it, vi } from "vitest";

const MNEMONIC = "test test test test test test test test test test test junk";

vi.mock("@/config/env", () => ({
    env: {
        WALLET_MASTER_MNEMONIC: MNEMONIC,
        OPS_WALLET_INDEX: 9000,
        RELAYER_WALLET_INDEX: 0,
    },
}));

describe("deriveOpsAccount", () => {
    it("derives the reserved ops index, not the relayer index", async () => {
        const { deriveOpsAccount } = await import("../ops-account");
        const { deriveAccount } = await import("../derive");

        expect(deriveOpsAccount().address).toBe(
            deriveAccount(MNEMONIC, 9000).address,
        );
        expect(deriveOpsAccount().address).not.toBe(
            deriveAccount(MNEMONIC, 0).address,
        );
    });
});
