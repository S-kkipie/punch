import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    type Address,
    createPublicClient,
    createWalletClient,
    type Hex,
    http,
    keccak256,
    parseEther,
    parseUnits,
    toBytes,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { abis } from "../src/core/chain/abis";

const RPC = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk";
const appMnemonic = process.env.WALLET_MASTER_MNEMONIC ?? ANVIL_MNEMONIC;
const deployer = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 0 });

export const anvilDeployerAddress = deployer.address;
export function ownerAddressForIndex(index: number, mnemonic = appMnemonic) {
    return mnemonicToAccount(mnemonic, { addressIndex: index }).address;
}

export type AddressMap = {
    cafeRegistry: Address;
    planManager: Address;
    consumptionLog: Address;
    punchVault: Address;
    networkFund: Address;
    campaignEscrow: Address;
    mockPEN: Address;
};

type Artifact = { abi: readonly unknown[]; bytecode: { object: Hex } };

function artifact(name: string): Artifact {
    return JSON.parse(
        readFileSync(
            join(
                import.meta.dirname,
                `../packages/contracts/out/${name}.sol/${name}.json`,
            ),
            "utf8",
        ),
    ) as Artifact;
}

export async function waitForWrite(
    pub: Pick<
        ReturnType<typeof createPublicClient>,
        "waitForTransactionReceipt"
    >,
    hash: Hex,
    operation: string,
): Promise<void> {
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
        throw new Error(
            `${operation} failed with reverted transaction ${hash}`,
        );
    }
}

export async function deployAll(rpcUrl = RPC): Promise<AddressMap> {
    const wallet = createWalletClient({
        account: deployer,
        chain: foundry,
        transport: http(rpcUrl),
    });
    const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });

    async function deploy(
        name: string,
        args: readonly unknown[] = [],
    ): Promise<Address> {
        const item = artifact(name);
        const hash = await wallet.deployContract({
            abi: item.abi,
            bytecode: item.bytecode.object,
            args: [...args],
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
            throw new Error(
                `deploy ${name} failed with reverted transaction ${hash}`,
            );
        }
        if (!receipt.contractAddress)
            throw new Error(`Deployment produced no address: ${name}`);
        return receipt.contractAddress;
    }

    const mockPEN = await deploy("MockPEN");
    const cafeRegistry = await deploy("CafeRegistry", [deployer.address]);
    const networkFund = await deploy("NetworkFund", [mockPEN, cafeRegistry]);
    const punchVault = await deploy("PunchVault", [mockPEN, cafeRegistry]);
    const planManager = await deploy("PlanManager", [
        mockPEN,
        cafeRegistry,
        punchVault,
        networkFund,
        deployer.address,
    ]);
    const consumptionLog = await deploy("ConsumptionLog", [
        cafeRegistry,
        planManager,
        punchVault,
    ]);
    const campaignEscrow = await deploy("CampaignEscrow", [
        mockPEN,
        cafeRegistry,
    ]);

    const registryAbi = abis.cafeRegistry;
    const planAbi = abis.planManager;
    const vaultAbi = abis.punchVault;
    const fundAbi = abis.networkFund;

    await waitForWrite(
        pub,
        await wallet.writeContract({
            address: cafeRegistry,
            abi: registryAbi,
            functionName: "grantRole",
            args: [keccak256(toBytes("REGISTRAR_ROLE")), deployer.address],
        }),
        "grant registrar role",
    );
    await waitForWrite(
        pub,
        await wallet.writeContract({
            address: planManager,
            abi: planAbi,
            functionName: "setConsumptionLog",
            args: [consumptionLog],
        }),
        "set consumption log",
    );
    await waitForWrite(
        pub,
        await wallet.writeContract({
            address: punchVault,
            abi: vaultAbi,
            functionName: "setConsumptionLog",
            args: [consumptionLog],
        }),
        "set consumption log",
    );
    await waitForWrite(
        pub,
        await wallet.writeContract({
            address: networkFund,
            abi: fundAbi,
            functionName: "setCampaignEscrow",
            args: [campaignEscrow],
        }),
        "set campaign escrow",
    );

    const escrowAbi = abis.campaignEscrow;
    const relayerAccount = mnemonicToAccount(appMnemonic, {
        addressIndex: Number(process.env.RELAYER_WALLET_INDEX ?? 0),
    });
    const opsAccount = mnemonicToAccount(appMnemonic, {
        addressIndex: Number(process.env.OPS_WALLET_INDEX ?? 9000),
    });

    await waitForWrite(
        pub,
        await wallet.sendTransaction({
            to: opsAccount.address,
            value: parseEther("10"),
        } as never),
        "fund ops wallet",
    );

    // Order matters: setCampaignOperator is onlyOwner and the deployer is
    // still the owner at this point.
    await waitForWrite(
        pub,
        await wallet.writeContract({
            address: campaignEscrow,
            abi: escrowAbi,
            functionName: "setCampaignOperator",
            args: [relayerAccount.address],
        }),
        "set campaign operator",
    );
    await waitForWrite(
        pub,
        await wallet.writeContract({
            address: campaignEscrow,
            abi: escrowAbi,
            functionName: "transferOwnership",
            args: [opsAccount.address],
        }),
        "transfer escrow ownership to ops",
    );

    return {
        cafeRegistry,
        planManager,
        consumptionLog,
        punchVault,
        networkFund,
        campaignEscrow,
        mockPEN,
    };
}

export async function seedCafe(opts: {
    rpcUrl?: string;
    addresses: AddressMap;
    ownerWalletIndex: number;
    chainProductId?: bigint;
    eligibleProductIds?: readonly bigint[];
}): Promise<{ chainCafeId: bigint; ownerAddress: `0x${string}` }> {
    const rpcUrl = opts.rpcUrl ?? RPC;
    const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
    const deployerWallet = createWalletClient({
        account: deployer,
        chain: foundry,
        transport: http(rpcUrl),
    });
    const owner = mnemonicToAccount(appMnemonic, {
        addressIndex: opts.ownerWalletIndex,
    });
    const ownerAddress = owner.address as `0x${string}`;
    const ownerWallet = createWalletClient({
        account: owner,
        chain: foundry,
        transport: http(rpcUrl),
    });
    const productIds = opts.eligibleProductIds ?? [opts.chainProductId ?? 1n];

    if (ownerAddress.toLowerCase() !== deployer.address.toLowerCase()) {
        await waitForWrite(
            pub,
            await deployerWallet.sendTransaction({
                to: ownerAddress,
                value: parseEther("1"),
            }),
            "fund cafe owner",
        );
    }
    await waitForWrite(
        pub,
        await deployerWallet.writeContract({
            address: opts.addresses.cafeRegistry,
            abi: abis.cafeRegistry,
            functionName: "registerCafe",
            args: [ownerAddress],
        }),
        "register cafe",
    );
    const chainCafeId = (await pub.readContract({
        address: opts.addresses.cafeRegistry,
        abi: abis.cafeRegistry,
        functionName: "cafeCount",
    })) as bigint;
    await waitForWrite(
        pub,
        await deployerWallet.writeContract({
            address: opts.addresses.cafeRegistry,
            abi: abis.cafeRegistry,
            functionName: "setCafeStatus",
            args: [chainCafeId, 1],
        }),
        "activate cafe",
    );
    for (const productId of productIds) {
        await waitForWrite(
            pub,
            await ownerWallet.writeContract({
                address: opts.addresses.cafeRegistry,
                abi: abis.cafeRegistry,
                functionName: "setEligibleProduct",
                args: [chainCafeId, productId, 0, true],
            }),
            `set eligible product ${productId}`,
        );
    }
    await waitForWrite(
        pub,
        await deployerWallet.writeContract({
            address: opts.addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "mint",
            args: [ownerAddress, parseUnits("49", 6)],
        }),
        "mint owner PEN",
    );
    await waitForWrite(
        pub,
        await ownerWallet.writeContract({
            address: opts.addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "approve",
            args: [opts.addresses.planManager, parseUnits("49", 6)],
        }),
        "approve PEN",
    );
    await waitForWrite(
        pub,
        await ownerWallet.writeContract({
            address: opts.addresses.planManager,
            abi: abis.planManager,
            functionName: "subscribe",
            args: [chainCafeId],
        }),
        "subscribe cafe",
    );
    return { chainCafeId, ownerAddress };
}

if (process.argv[1]?.endsWith("dev-chain.ts")) {
    const map = await deployAll();
    writeFileSync(
        join(import.meta.dirname, "../src/core/chain/addresses.local.json"),
        `${JSON.stringify(map, null, 4)}\n`,
    );
    console.log("deployed:", map);
}
