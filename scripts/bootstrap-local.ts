import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { abis } from "../src/core/chain/abis";
import { bootstrapRepository } from "../src/core/chain/server/bootstrap-local/repository";
import {
    type BootstrapChain,
    bootstrapApprovedSeedCafes,
    type LiveCafe,
} from "../src/core/chain/server/bootstrap-local/service";
import { type AddressMap, ownerAddressForIndex, seedCafe } from "./dev-chain";

const rpcUrl = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
const addresses = JSON.parse(
    readFileSync(
        join(import.meta.dirname, "../src/core/chain/addresses.local.json"),
        "utf8",
    ),
) as AddressMap;
function liveChain(): BootstrapChain {
    const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
    return {
        ownerAddressForIndex: (index) => ownerAddressForIndex(index),
        countCafes: () =>
            pub.readContract({
                address: addresses.cafeRegistry,
                abi: abis.cafeRegistry,
                functionName: "cafeCount",
            }) as Promise<bigint>,
        inspectCafe: async (chainCafeId): Promise<LiveCafe | null> => {
            const count = (await pub.readContract({
                address: addresses.cafeRegistry,
                abi: abis.cafeRegistry,
                functionName: "cafeCount",
            })) as bigint;
            if (chainCafeId < 1n || chainCafeId > count) return null;
            const [owner, status] = (await pub.readContract({
                address: addresses.cafeRegistry,
                abi: abis.cafeRegistry,
                functionName: "getCafe",
                args: [chainCafeId],
            })) as readonly [`0x${string}`, number];
            const active = status === 1;
            const eligibleProductIds: bigint[] = [];
            for (let productId = 1n; productId <= 100n; productId++) {
                if (
                    await pub.readContract({
                        address: addresses.cafeRegistry,
                        abi: abis.cafeRegistry,
                        functionName: "isEligible",
                        args: [chainCafeId, productId, 0],
                    })
                )
                    eligibleProductIds.push(productId);
            }
            const planActive = (await pub.readContract({
                address: addresses.planManager,
                abi: abis.planManager,
                functionName: "planActive",
                args: [chainCafeId],
            })) as boolean;
            const credits = (await pub.readContract({
                address: addresses.planManager,
                abi: abis.planManager,
                functionName: "credits",
                args: [chainCafeId],
            })) as bigint;
            return {
                chainCafeId,
                ownerAddress: owner,
                active,
                eligibleProductIds,
                planActive,
                credits,
            };
        },
        seedCafe: async ({ ownerWalletIndex, eligibleProductIds }) => {
            const result = await seedCafe({
                rpcUrl,
                addresses,
                ownerWalletIndex,
                eligibleProductIds,
            });
            return { ...result, eligibleProductIds };
        },
        verifyCafe: async ({
            chainCafeId,
            ownerAddress,
            eligibleProductIds,
        }) => {
            const live = await thisInspect(
                pub,
                chainCafeId,
                eligibleProductIds,
            );
            if (
                !live ||
                live.ownerAddress.toLowerCase() !==
                    ownerAddress.toLowerCase() ||
                !live.active ||
                !live.planActive ||
                live.credits !== 100n ||
                live.eligibleProductIds.length !== eligibleProductIds.length
            ) {
                throw new Error(
                    `bootstrap café ${chainCafeId}: live verification failed`,
                );
            }
        },
    };
}

async function thisInspect(
    pub: ReturnType<typeof createPublicClient>,
    chainCafeId: bigint,
    eligibleProductIds: bigint[],
): Promise<LiveCafe | null> {
    const [owner, status] = (await pub.readContract({
        address: addresses.cafeRegistry,
        abi: abis.cafeRegistry,
        functionName: "getCafe",
        args: [chainCafeId],
    })) as readonly [`0x${string}`, number];
    const actual = await Promise.all(
        eligibleProductIds.map((id) =>
            pub.readContract({
                address: addresses.cafeRegistry,
                abi: abis.cafeRegistry,
                functionName: "isEligible",
                args: [chainCafeId, id, 0],
            }),
        ),
    );
    const planActive = (await pub.readContract({
        address: addresses.planManager,
        abi: abis.planManager,
        functionName: "planActive",
        args: [chainCafeId],
    })) as boolean;
    const credits = (await pub.readContract({
        address: addresses.planManager,
        abi: abis.planManager,
        functionName: "credits",
        args: [chainCafeId],
    })) as bigint;
    return {
        chainCafeId,
        ownerAddress: owner,
        active: status === 1,
        eligibleProductIds: eligibleProductIds.filter((_, i) => actual[i]),
        planActive,
        credits,
    };
}

bootstrapApprovedSeedCafes({
    repository: bootstrapRepository,
    chain: liveChain(),
})
    .then(() => console.log("local bootstrap complete"))
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
