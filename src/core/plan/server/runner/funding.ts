import "server-only";

import { type Address, parseEther } from "viem";
import { type HDAccount, mnemonicToAccount } from "viem/accounts";
import { env } from "@/config/env";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import {
    createChainPublicClient,
    createChainWalletClient,
} from "@/core/chain/chain";

export const MIN_GAS_WEI = parseEther("0.01");
export const GAS_TOPUP_WEI = parseEther("0.1");

/**
 * Anvil's well-known development mnemonic. Test-only, chain 31337: it funds gas
 * for custodial signers on the local chain and is never used anywhere else.
 */
const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk";

export class FundingUnavailableError extends Error {
    constructor() {
        super("funding_unavailable");
        this.name = "FundingUnavailableError";
    }
}

export type FundingDeps = {
    chainEnv: string;
    getBalance: (address: Address) => Promise<bigint>;
    readMpenBalance: (address: Address) => Promise<bigint>;
    sendGas: (to: Address, value: bigint) => Promise<void>;
    callFaucet: (account: HDAccount, amount: bigint) => Promise<void>;
};

function localFunder(): HDAccount {
    return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 0 });
}

const defaults: FundingDeps = {
    chainEnv: env.CHAIN_ENV,
    getBalance: async (address) =>
        createChainPublicClient().getBalance({ address }),
    readMpenBalance: async (address) =>
        createChainPublicClient().readContract({
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [address],
        }) as Promise<bigint>,
    sendGas: async (to, value) => {
        const funder = localFunder();
        const wallet = createChainWalletClient(undefined, funder);
        const hash = await wallet.sendTransaction({
            account: funder,
            to,
            value,
        });
        await createChainPublicClient().waitForTransactionReceipt({ hash });
    },
    callFaucet: async (account, amount) => {
        const wallet = createChainWalletClient(undefined, account);
        const hash = await wallet.writeContract({
            account,
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "faucet",
            args: [amount],
        });
        await createChainPublicClient().waitForTransactionReceipt({ hash });
    },
};

function requireLocal(chainEnv: string) {
    if (chainEnv !== "local") throw new FundingUnavailableError();
}

export async function ensureGas(
    signer: Address,
    overrides: Partial<FundingDeps> = {},
): Promise<void> {
    const d = { ...defaults, ...overrides };
    const balance = await d.getBalance(signer);
    if (balance >= MIN_GAS_WEI) return;
    requireLocal(d.chainEnv);
    await d.sendGas(signer, GAS_TOPUP_WEI);
}

export async function ensureMpen(
    input: { account: HDAccount; price: bigint },
    overrides: Partial<FundingDeps> = {},
): Promise<void> {
    const d = { ...defaults, ...overrides };
    const balance = await d.readMpenBalance(input.account.address);
    if (balance >= input.price) return;
    requireLocal(d.chainEnv);
    await d.callFaucet(input.account, input.price);
}
