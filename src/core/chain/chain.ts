import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";

export const chain = arbitrumSepolia;

export function createChainPublicClient(rpcUrl?: string) {
    return createPublicClient({ chain, transport: http(rpcUrl) });
}
