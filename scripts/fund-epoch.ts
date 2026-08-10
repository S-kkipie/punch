import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import {
    formatMpen,
    requestedEpoch,
} from "@/core/chain/server/network-fund/epoch";
import { fundCurrentEpoch } from "@/core/chain/server/network-fund/epoch-ops";

const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk";

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

    const result = await fundCurrentEpoch(
        { pub, wallet, addresses, listChainCafeIds: async () => [] },
        epoch,
    );
    const buckets = await pub.readContract({
        address: addresses.networkFund,
        abi: abis.networkFund,
        functionName: "getEpoch",
        args: [BigInt(epoch)],
    });

    console.log(
        `Epoch ${result.epoch} funded with ${formatMpen(result.amount)}`,
    );
    console.log(`  origin:       ${formatMpen(buckets.originPool)}`);
    console.log(`  acquisition:  ${formatMpen(buckets.acquisitionPool)}`);
    console.log(`  crawl:        ${formatMpen(buckets.crawlPool)}`);
    console.log(`  contingency:  ${formatMpen(buckets.contingencyPool)}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
