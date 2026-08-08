import "server-only";

import { createPublicClient, createWalletClient, http } from "viem";
import { arbitrumSepolia, foundry } from "viem/chains";
import { env } from "@/config/env";

export const chain = arbitrumSepolia;

export function chainForEnv() {
    return env.CHAIN_ENV === "local" ? foundry : arbitrumSepolia;
}

export function createChainPublicClient(rpcUrl?: string) {
    return createPublicClient({
        chain: chainForEnv(),
        transport: http(rpcUrl ?? env.CHAIN_RPC_URL),
    });
}

export function createChainWalletClient(rpcUrl?: string) {
    return createWalletClient({
        chain: chainForEnv(),
        transport: http(rpcUrl ?? env.CHAIN_RPC_URL),
    });
}
