import { isAddress } from "viem";
import { describe, expect, it } from "vitest";
import { addresses, contractNames } from "@/core/chain/addresses";
import {
    chain,
    chainForEnv,
    createChainPublicClient,
    createChainWalletClient,
} from "@/core/chain/chain";
import { deriveAccount } from "@/core/chain/server/wallet/derive";

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

    it("binds a provided local account for non-unlocked submitters", () => {
        const account = deriveAccount(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            4,
        );

        const client = createChainWalletClient(undefined, account);

        expect(client.account).toBeDefined();
        expect(client.account?.type).toBe("local");
        expect(client.account?.address).toBe(account.address);
    });
});
