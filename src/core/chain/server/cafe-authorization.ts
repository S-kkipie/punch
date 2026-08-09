import "server-only";

import type { Address, PublicClient } from "viem";
import { abis } from "../abis";
import { getAddresses } from "../addresses";
import { createChainPublicClient } from "../chain";

export type CafeAuthorizationDeps = {
    publicClient: Pick<PublicClient, "readContract">;
};

export async function isAuthorizedCafeOperator(
    input: {
        chainCafeId: number;
        walletAddress: `0x${string}`;
    },
    deps?: CafeAuthorizationDeps,
): Promise<boolean> {
    const publicClient = deps?.publicClient ?? createChainPublicClient();
    return publicClient.readContract({
        address: getAddresses().cafeRegistry,
        abi: abis.cafeRegistry,
        functionName: "isAuthorized",
        args: [BigInt(input.chainCafeId), input.walletAddress as Address],
    });
}
