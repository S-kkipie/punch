import "server-only";

import type { PublicClient } from "viem";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";

export type PlanChainState = {
    planActive: boolean;
    unallocatedReserve: bigint;
};

export type PlanChainReaderDeps = {
    publicClient: Pick<PublicClient, "readContract">;
};

export async function readPlanChainState(
    chainCafeId: number,
    deps?: PlanChainReaderDeps,
): Promise<PlanChainState> {
    const publicClient = deps?.publicClient ?? createChainPublicClient();
    const address = getAddresses().planManager;
    const [planActive, unallocatedReserve] = await Promise.all([
        publicClient.readContract({
            address,
            abi: abis.planManager,
            functionName: "planActive",
            args: [BigInt(chainCafeId)],
        }) as Promise<boolean>,
        publicClient.readContract({
            address,
            abi: abis.planManager,
            functionName: "unallocatedReserve",
            args: [BigInt(chainCafeId)],
        }) as Promise<bigint>,
    ]);
    return { planActive, unallocatedReserve };
}
