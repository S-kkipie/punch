import { createPublicClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { describe, expect, it } from "vitest";
import { abis } from "@/core/chain/abis";
import {
    anvilDeployerAddress,
    deployAll,
    ownerAddressForIndex,
    waitForWrite,
} from "../../../../scripts/dev-chain";

const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk";
const appMnemonic = process.env.WALLET_MASTER_MNEMONIC ?? ANVIL_MNEMONIC;

function relayerAddress() {
    return mnemonicToAccount(appMnemonic, {
        addressIndex: Number(process.env.RELAYER_WALLET_INDEX ?? 0),
    }).address;
}

function opsAddress() {
    return mnemonicToAccount(appMnemonic, {
        addressIndex: Number(process.env.OPS_WALLET_INDEX ?? 9000),
    }).address;
}

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);

const hash =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;

describe("development chain bootstrap", () => {
    it("rejects mined reverted writes with action and transaction hash", async () => {
        const pub = {
            waitForTransactionReceipt: async () => ({ status: "reverted" }),
        } as never;

        await expect(waitForWrite(pub, hash, "register cafe")).rejects.toThrow(
            /register cafe.*reverted.*0x1234/i,
        );
    });

    it("resolves successful mined writes", async () => {
        const pub = {
            waitForTransactionReceipt: async () => ({ status: "success" }),
        } as never;

        await expect(
            waitForWrite(pub, hash, "register cafe"),
        ).resolves.toBeUndefined();
    });

    it("keeps deployment funded by Anvil while custodial owners use the app mnemonic", () => {
        expect(anvilDeployerAddress).toBe(
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        );
        expect(
            ownerAddressForIndex(
                0,
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            ),
        ).not.toBe(anvilDeployerAddress);
    });
});

describeIntegration("development chain escrow wiring", () => {
    it("points the escrow operator at the relayer and hands ownership to ops", async () => {
        const rpcUrl = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
        const addresses = await deployAll(rpcUrl);
        const pub = createPublicClient({
            chain: foundry,
            transport: http(rpcUrl),
        });

        const operator = await pub.readContract({
            address: addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "campaignOperator",
        });
        const owner = await pub.readContract({
            address: addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "owner",
        });

        expect(operator).toBe(relayerAddress());
        expect(owner).toBe(opsAddress());
        expect(operator).not.toBe(owner);
    });
});
