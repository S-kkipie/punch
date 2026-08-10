import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
    createPublicClient,
    createWalletClient,
    decodeEventLog,
    http,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { env } from "../src/config/env";
import { abis } from "../src/core/chain/abis";
import {
    assertLocalChain31337,
    seedHistoricalConsumptions,
} from "../src/core/chain/server/bootstrap-local/historical-consumptions";
import { bootstrapRepository } from "../src/core/chain/server/bootstrap-local/repository";
import {
    type BootstrapChain,
    bootstrapApprovedSeedCafes,
    bootstrapDemoCampaign,
    type DemoCampaignChain,
    type LiveCafe,
} from "../src/core/chain/server/bootstrap-local/service";
import { runIndexerOnce } from "../src/core/chain/server/indexer/indexer";
import { deriveAccount } from "../src/core/chain/server/wallet/derive";
import { deriveOpsAccount } from "../src/core/chain/server/wallet/ops-account";
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

function liveDemoCampaignChain(): DemoCampaignChain {
    const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
    const ops = deriveOpsAccount();
    const deployer = mnemonicToAccount(
        "test test test test test test test test test test test junk",
        { addressIndex: 0 },
    );
    const wallets = new Map<string, ReturnType<typeof createWalletClient>>();
    const wallet = (account: typeof ops) => {
        const existing = wallets.get(account.address);
        if (existing) return existing;
        const client = createWalletClient({
            account,
            chain: foundry,
            transport: http(rpcUrl),
        });
        wallets.set(account.address, client);
        return client;
    };
    const accountForAddress = (address: `0x${string}`) => {
        for (let index = 0; index < 100; index++) {
            const account = deriveAccount(env.WALLET_MASTER_MNEMONIC, index);
            if (account.address.toLowerCase() === address.toLowerCase())
                return account;
        }
        throw new Error(`bootstrap owner wallet ${address} cannot be derived`);
    };
    const write = async (
        account: typeof ops,
        address: `0x${string}`,
        abi: readonly unknown[],
        functionName: string,
        args: readonly unknown[],
    ) => {
        const hash = await wallet(account).writeContract({
            address,
            abi,
            chain: foundry,
            account: account.address,
            functionName: functionName as never,
            args: args as never,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success")
            throw new Error(`bootstrap ${functionName} reverted: ${hash}`);
        return receipt;
    };
    return {
        addresses: { campaignEscrow: addresses.campaignEscrow },
        opsAddress: ops.address,
        deployerAddress: deployer.address,
        ownerAddressForIndex,
        mint: async ({ to, amount }) => {
            await write(deployer, addresses.mockPEN, abis.mockPEN, "mint", [
                to,
                amount,
            ]);
        },
        approve: async ({ spender, amount, signer }) => {
            await write(
                accountForAddress(signer),
                addresses.mockPEN,
                abis.mockPEN,
                "approve",
                [spender, amount],
            );
        },
        createCampaign: async ({ sourceCafeId }) => {
            const receipt = await write(
                ops,
                addresses.campaignEscrow,
                abis.campaignEscrow,
                "createCampaign",
                [sourceCafeId],
            );
            return { receipt };
        },
        fundCampaign: async ({ campaignId, amount, signer }) => {
            await write(
                accountForAddress(signer),
                addresses.campaignEscrow,
                abis.campaignEscrow,
                "fundCampaign",
                [campaignId, amount],
            );
        },
        publishCampaign: async ({
            campaignId,
            voucherPayout,
            maxVouchers,
            expiry,
        }) => {
            await write(
                ops,
                addresses.campaignEscrow,
                abis.campaignEscrow,
                "publishCampaign",
                [campaignId, voucherPayout, maxVouchers, expiry],
            );
        },
        parseCreatedCampaignId: ({ logs }) => {
            for (const log of logs) {
                try {
                    const topicList = (
                        log as { topics: readonly `0x${string}`[] }
                    ).topics;
                    const decoded = decodeEventLog({
                        abi: abis.campaignEscrow,
                        data: (log as { data: `0x${string}` }).data,
                        topics: topicList.length
                            ? [topicList[0], ...topicList.slice(1)]
                            : [],
                    });
                    if (decoded.eventName === "CampaignCreated")
                        return (decoded.args as { campaignId: bigint })
                            .campaignId;
                } catch {}
            }
            return null;
        },
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
    await bootstrapDemoCampaign({
        repository: bootstrapRepository,
        chain: liveDemoCampaignChain(),
        cafeSlug: "esquina-sur",
    });
    await runIndexerOnce();

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
