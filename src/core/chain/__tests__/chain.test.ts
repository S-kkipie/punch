import { isAddress } from "viem";
import { describe, expect, it } from "vitest";
import { addresses, contractNames } from "@/core/chain/addresses";
import { chain, createChainPublicClient } from "@/core/chain/chain";

describe("chain config", () => {
    it("targets Arbitrum Sepolia", () => {
        expect(chain.id).toBe(421614);
    });

    it("creates a public client bound to the chain", () => {
        const client = createChainPublicClient();
        expect(client.chain?.id).toBe(421614);
    });

    it("has a valid address entry per contract", () => {
        for (const name of contractNames) {
            const address = addresses.arbitrumSepolia[name];
            expect(isAddress(address)).toBe(true);
        }
    });
});
