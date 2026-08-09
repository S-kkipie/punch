import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MNEMONIC = "test test test test test test test test test test test junk";

function stubRequiredEnv(opsIndex: string, relayerIndex: string) {
    vi.stubEnv("DATABASE_URL", "https://example.com/database");
    vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
    vi.stubEnv("WALLET_MASTER_MNEMONIC", MNEMONIC);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
    vi.stubEnv("OPS_WALLET_INDEX", opsIndex);
    vi.stubEnv("RELAYER_WALLET_INDEX", relayerIndex);
}

describe("env wallet index safety", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("rejects an ops and relayer wallet index collision", async () => {
        stubRequiredEnv("7", "7");

        await expect(import("@/config/env")).rejects.toThrow(
            "OPS_WALLET_INDEX must differ from RELAYER_WALLET_INDEX",
        );
    });

    it("allows differing ops and relayer wallet indexes", async () => {
        stubRequiredEnv("9000", "0");

        await expect(import("@/config/env")).resolves.toMatchObject({
            env: expect.objectContaining({
                OPS_WALLET_INDEX: 9000,
                RELAYER_WALLET_INDEX: 0,
            }),
        });
    });
});
