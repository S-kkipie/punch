import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { abis } from "../src/core/chain/abis";
import {
    assertLocalChain31337,
    seedHistoricalConsumptions,
} from "../src/core/chain/server/bootstrap-local/historical-consumptions";
import { bootstrapRepository } from "../src/core/chain/server/bootstrap-local/repository";
import {
    type BootstrapChain,
    bootstrapApprovedSeedCafes,
    type LiveCafe,
} from "../src/core/chain/server/bootstrap-local/service";
import { db } from "../src/server/drizzle/db";
import { user } from "../src/server/drizzle/schemas/auth-schema";
import { cafe } from "../src/server/drizzle/schemas/cafe-schema";
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
            const eligibleProducts: LiveCafe["eligibleProducts"] = [];
            for (let productId = 1n; productId <= 100n; productId++) {
                for (const kind of [0, 1] as const) {
                    if (
                        await pub.readContract({
                            address: addresses.cafeRegistry,
                            abi: abis.cafeRegistry,
                            functionName: "isEligible",
                            args: [chainCafeId, productId, kind],
                        })
                    )
                        eligibleProducts.push({ productId, kind });
                }
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
                eligibleProducts,
                planActive,
                credits,
            };
        },
        ensureEligibleProducts: async ({
            chainCafeId,
            ownerWalletIndex,
            eligibleProducts,
        }) => {
            const owner = mnemonicToAccount(
                process.env.WALLET_MASTER_MNEMONIC ??
                    "test test test test test test test test test test test junk",
                { addressIndex: ownerWalletIndex },
            );
            const wallet = createWalletClient({
                account: owner,
                chain: foundry,
                transport: http(rpcUrl),
            });
            for (const product of eligibleProducts) {
                const eligible = await pub.readContract({
                    address: addresses.cafeRegistry,
                    abi: abis.cafeRegistry,
                    functionName: "isEligible",
                    args: [chainCafeId, product.productId, product.kind],
                });
                if (!eligible) {
                    await pub.waitForTransactionReceipt({
                        hash: await wallet.writeContract({
                            address: addresses.cafeRegistry,
                            abi: abis.cafeRegistry,
                            functionName: "setEligibleProduct",
                            args: [
                                chainCafeId,
                                product.productId,
                                product.kind,
                                true,
                            ],
                        }),
                    });
                }
            }
        },
        seedCafe: async ({ ownerWalletIndex, eligibleProducts }) => {
            const result = await seedCafe({
                rpcUrl,
                addresses,
                ownerWalletIndex,
                eligibleProducts,
            });
            return { ...result, eligibleProducts };
        },
        verifyCafe: async ({ chainCafeId, ownerAddress, eligibleProducts }) => {
            const live = await thisInspect(pub, chainCafeId, eligibleProducts);
            if (
                !live ||
                live.ownerAddress.toLowerCase() !==
                    ownerAddress.toLowerCase() ||
                !live.active ||
                !live.planActive ||
                live.credits !== 100n ||
                live.eligibleProducts.length !== eligibleProducts.length ||
                live.eligibleProducts.some(
                    (product, index) =>
                        product.productId !==
                            eligibleProducts[index]?.productId ||
                        product.kind !== eligibleProducts[index]?.kind,
                )
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
    eligibleProducts: LiveCafe["eligibleProducts"],
): Promise<LiveCafe | null> {
    const [owner, status] = (await pub.readContract({
        address: addresses.cafeRegistry,
        abi: abis.cafeRegistry,
        functionName: "getCafe",
        args: [chainCafeId],
    })) as readonly [`0x${string}`, number];
    const actual = await Promise.all(
        eligibleProducts.map(({ productId, kind }) =>
            pub.readContract({
                address: addresses.cafeRegistry,
                abi: abis.cafeRegistry,
                functionName: "isEligible",
                args: [chainCafeId, productId, kind],
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
        eligibleProducts: eligibleProducts.filter((_, i) => actual[i]),
        planActive,
        credits,
    };
}

async function main() {
    const publicClient = createPublicClient({
        chain: foundry,
        transport: http(rpcUrl),
    });
    await assertLocalChain31337(publicClient);
    await bootstrapApprovedSeedCafes({
        repository: bootstrapRepository,
        chain: liveChain(),
    });

    if (process.argv.includes("--seed-history")) {
        const [consumer] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, "demo-consumer@punch.pe"));
        const [targetCafe] = await db
            .select({ id: cafe.id })
            .from(cafe)
            .where(eq(cafe.slug, "esquina-sur"));
        if (!consumer || !targetCafe) {
            throw new Error(
                "historical seeding demo consumer or target café is missing",
            );
        }
        const hashes = await seedHistoricalConsumptions({
            consumerUserId: consumer.id,
            count: 11,
            targetCafeId: targetCafe.id,
        });
        console.log(`historical seeding complete: ${hashes.length} receipts`);
    } else {
        console.log("local bootstrap complete");
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
