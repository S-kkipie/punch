import { isNotNull } from "drizzle-orm";
import {
    createPublicClient,
    createWalletClient,
    formatUnits,
    http,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { currentEpoch } from "@/core/chain/server/network-fund/epoch";
import { closeEpoch } from "@/core/chain/server/network-fund/epoch-ops";
import { db } from "@/server/drizzle/db";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";

const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk";

function requestedEpoch(args: string[]): number {
    const flagIndex = args.indexOf("--epoch");
    const value =
        flagIndex >= 0
            ? args[flagIndex + 1]
            : args.find((arg) => arg.startsWith("--epoch="))?.slice(8);
    if (value === undefined) return currentEpoch();
    if (
        !/^\d{6}$/.test(value) ||
        Number(value.slice(4)) > 12 ||
        value.endsWith("00")
    ) {
        throw new Error("--epoch must use YYYYMM with a month from 01 to 12");
    }
    return Number(value);
}

function mpen(amount: bigint): string {
    return `${formatUnits(amount, 6)} mPEN`;
}

async function listChainCafeIds(): Promise<number[]> {
    const rows = await db
        .select({ chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .where(isNotNull(cafe.chainCafeId));
    return rows.flatMap(({ chainCafeId }) =>
        chainCafeId === null ? [] : [chainCafeId],
    );
}

async function main() {
    const rpcUrl = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
    const account = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 0 });
    const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
    const wallet = createWalletClient({
        account,
        chain: foundry,
        transport: http(rpcUrl),
    });
    const addresses = getAddresses();
    const epoch = requestedEpoch(process.argv.slice(2));

    const result = await closeEpoch(
        { pub, wallet, addresses, listChainCafeIds },
        epoch,
    );
    const buckets = await pub.readContract({
        address: addresses.networkFund,
        abi: abis.networkFund,
        functionName: "getEpoch",
        args: [BigInt(epoch)],
    });

    console.log(`Epoch ${result.epoch} finalized`);
    console.log(`  origin:       ${mpen(buckets.originPool)}`);
    console.log(`  origin paid:  ${mpen(buckets.originPaid)}`);
    console.log(`  acquisition:  ${mpen(buckets.acquisitionPool)}`);
    console.log(`  crawl:        ${mpen(buckets.crawlPool)}`);
    console.log(`  contingency:  ${mpen(buckets.contingencyPool)}`);
    if (result.claims.length === 0) {
        console.log(
            "  claims: none (cafes without referrals or already claimed were skipped)",
        );
        return;
    }
    console.log("  claims:");
    for (const claim of result.claims) {
        console.log(
            `    cafe ${claim.chainCafeId}: ${claim.referrals} referrals, ${mpen(claim.amount)}`,
        );
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
