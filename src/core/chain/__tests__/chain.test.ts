import { isAddress } from "viem";
import { describe, expect, it } from "vitest";
import { addresses, contractNames } from "@/core/chain/addresses";
import {
    chain,
    chainForEnv,
    createChainPublicClient,
} from "@/core/chain/chain";

describe("chain config", () => {
    it("uses one active chain source for the configured environment", () => {
        const client = createChainPublicClient();
        expect(chain.id).toBe(chainForEnv().id);
        expect(client.chain?.id).toBe(chainForEnv().id);
        expect(chain.id).toBe(31337);
    });

    it("has a valid address entry per contract", () => {
        for (const name of contractNames) {
            const address = addresses.arbitrumSepolia[name];
            expect(isAddress(address)).toBe(true);
        }
    });
});
