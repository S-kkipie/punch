import "server-only";

import {
    type Account,
    createPublicClient,
    createWalletClient,
    http,
} from "viem";
import { arbitrumSepolia, foundry } from "viem/chains";
import { env } from "@/config/env";

export function chainForEnv() {
    return env.CHAIN_ENV === "local" ? foundry : arbitrumSepolia;
}

export const chain = chainForEnv();

export function createChainPublicClient(rpcUrl?: string) {
    return createPublicClient({
        chain: chainForEnv(),
        transport: http(rpcUrl ?? env.CHAIN_RPC_URL),
    });
}

export function createChainWalletClient(rpcUrl?: string, account?: Account) {
    return createWalletClient({
        account,
        chain: chainForEnv(),
        transport: http(rpcUrl ?? env.CHAIN_RPC_URL),
    });
}
