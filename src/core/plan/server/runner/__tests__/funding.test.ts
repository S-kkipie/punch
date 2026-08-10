import { describe, expect, it, vi } from "vitest";
import {
    ensureGas,
    ensureMpen,
    FundingUnavailableError,
    GAS_TOPUP_WEI,
    MIN_GAS_WEI,
} from "../funding";

const signer = "0x3333333333333333333333333333333333333333" as const;
const account = { address: signer } as never;

describe("ensureGas", () => {
    it("tops up a signer below the minimum", async () => {
        const sendGas = vi.fn().mockResolvedValue(undefined);
        await ensureGas(signer, {
            chainEnv: "local",
            getBalance: vi.fn().mockResolvedValue(0n),
            sendGas,
        });
        expect(sendGas).toHaveBeenCalledWith(signer, GAS_TOPUP_WEI);
    });

    it("leaves a funded signer alone", async () => {
        const sendGas = vi.fn();
        await ensureGas(signer, {
            chainEnv: "local",
            getBalance: vi.fn().mockResolvedValue(MIN_GAS_WEI * 2n),
            sendGas,
        });
        expect(sendGas).not.toHaveBeenCalled();
    });

    it("refuses to fund outside the local chain", async () => {
        await expect(
            ensureGas(signer, {
                chainEnv: "arbitrumSepolia",
                getBalance: vi.fn().mockResolvedValue(0n),
                sendGas: vi.fn(),
            }),
        ).rejects.toBeInstanceOf(FundingUnavailableError);
    });
});

describe("ensureMpen", () => {
    it("calls the faucet for the missing amount only", async () => {
        const callFaucet = vi.fn().mockResolvedValue(undefined);
        await ensureMpen(
            { account, price: 49_000_000n },
            {
                chainEnv: "local",
                readMpenBalance: vi.fn().mockResolvedValue(0n),
                callFaucet,
            },
        );
        expect(callFaucet).toHaveBeenCalledWith(account, 49_000_000n);
    });

    it("skips the faucet when the signer already holds enough", async () => {
        const callFaucet = vi.fn();
        await ensureMpen(
            { account, price: 49_000_000n },
            {
                chainEnv: "local",
                readMpenBalance: vi.fn().mockResolvedValue(60_000_000n),
                callFaucet,
            },
        );
        expect(callFaucet).not.toHaveBeenCalled();
    });

    it("refuses to mint outside the local chain", async () => {
        await expect(
            ensureMpen(
                { account, price: 49_000_000n },
                {
                    chainEnv: "arbitrumSepolia",
                    readMpenBalance: vi.fn().mockResolvedValue(0n),
                    callFaucet: vi.fn(),
                },
            ),
        ).rejects.toBeInstanceOf(FundingUnavailableError);
    });

    it("carries the funding_unavailable marker in its message", () => {
        expect(new FundingUnavailableError().message).toBe(
            "funding_unavailable",
        );
    });
});
