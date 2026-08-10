import "server-only";

import type { Address, Hex } from "viem";
import { demoCampaignValues } from "@/core/punch/domain/demo-state";

export type BootstrapProduct = {
    id: string;
    chainProductId: number | null;
    createdAt?: Date;
    type: "emission" | "reward";
    approvalStatus: "pending" | "approved" | "rejected";
    active: boolean;
};

export type ApprovedSeedCafe = {
    id: string;
    slug: string;
    chainCafeId: number | null;
    ownerWalletIndex: number | null;
    ownerWalletAddress: string | null;
    operatorWalletAddresses?: string[];
    products: BootstrapProduct[];
};

export type BootstrapRepository = {
    listApprovedSeedCafes(): Promise<ApprovedSeedCafe[]>;
    persistCafeMappings(input: {
        cafeId: string;
        chainCafeId: number;
        products: { productId: string; chainProductId: number }[];
    }): Promise<void>;
};

export type LiveCafe = {
    chainCafeId: bigint;
    ownerAddress: `0x${string}`;
    active: boolean;
    eligibleProductIds: bigint[];
    planActive: boolean;
    credits: bigint;
};

export type DemoCampaign = {
    id: string;
    cafeId: string;
    chainCampaignId: number | null;
    voucherPayout: bigint | null;
    maxVouchers: number | null;
    windowEnd: Date;
};

export type DemoCampaignCafe = {
    id: string;
    slug: string;
    chainCafeId: number | null;
    ownerWalletIndex: number | null;
    ownerWalletAddress: string | null;
    campaign: DemoCampaign | null;
};

export type DemoCampaignRepository = {
    findCafeForCampaign(slug: string): Promise<DemoCampaignCafe | null>;
    insertDemoCampaign(input: {
        cafeId: string;
        values: ReturnType<typeof demoCampaignValues>;
        voucherPayout: bigint;
        maxVouchers: number;
    }): Promise<DemoCampaign>;
    linkCampaign(input: {
        campaignId: string;
        chainCampaignId: number;
    }): Promise<void>;
};

export type CampaignSigner = Address;
export type DemoCampaignChain = {
    mint(input: {
        to: Address;
        amount: bigint;
        signer: CampaignSigner;
    }): Promise<void>;
    createCampaign(input: {
        sourceCafeId: bigint;
        signer: CampaignSigner;
    }): Promise<{
        receipt: { status: "success" | "reverted"; logs: readonly unknown[] };
        hash?: Hex;
    }>;
    approve(input: {
        spender: Address;
        amount: bigint;
        signer: CampaignSigner;
    }): Promise<void>;
    fundCampaign(input: {
        campaignId: bigint;
        amount: bigint;
        signer: CampaignSigner;
    }): Promise<void>;
    publishCampaign(input: {
        campaignId: bigint;
        voucherPayout: bigint;
        maxVouchers: bigint;
        expiry: bigint;
        signer: CampaignSigner;
    }): Promise<void>;
    parseCreatedCampaignId(receipt: {
        logs: readonly unknown[];
    }): bigint | null;
    addresses: { campaignEscrow: Address };
    opsAddress: Address;
    deployerAddress: Address;
    ownerAddressForIndex(index: number): Address;
};

export type BootstrapChain = {
    ownerAddressForIndex(index: number): `0x${string}`;
    countCafes(): Promise<bigint>;
    inspectCafe(chainCafeId: bigint): Promise<LiveCafe | null>;
    seedCafe(input: {
        ownerWalletIndex: number;
        eligibleProductIds: bigint[];
    }): Promise<{
        chainCafeId: bigint;
        ownerAddress: `0x${string}`;
        eligibleProductIds: bigint[];
    }>;
    verifyCafe(input: {
        chainCafeId: bigint;
        ownerAddress: `0x${string}`;
        eligibleProductIds: bigint[];
    }): Promise<void>;
    authorizeOperator?(input: {
        chainCafeId: bigint;
        operatorAddress: `0x${string}`;
    }): Promise<void>;
    verifyOperator?(input: {
        chainCafeId: bigint;
        operatorAddress: `0x${string}`;
    }): Promise<boolean>;
};

function sameAddress(a: string, b: string) {
    return a.toLowerCase() === b.toLowerCase();
}

async function authorizeOperators(input: {
    chain: BootstrapChain;
    chainCafeId: bigint;
    addresses?: string[];
}): Promise<void> {
    for (const operatorAddress of input.addresses ?? []) {
        if (!input.chain.authorizeOperator || !input.chain.verifyOperator) {
            throw new Error("bootstrap operator authorization is unavailable");
        }
        const address = operatorAddress as `0x${string}`;
        await input.chain.authorizeOperator({
            chainCafeId: input.chainCafeId,
            operatorAddress: address,
        });
        if (
            !(await input.chain.verifyOperator({
                chainCafeId: input.chainCafeId,
                operatorAddress: address,
            }))
        ) {
            throw new Error(
                `bootstrap operator authorization failed for ${operatorAddress}`,
            );
        }
    }
}

export async function bootstrapDemoCampaign(input: {
    repository: DemoCampaignRepository;
    chain: DemoCampaignChain;
    cafeSlug: string;
}): Promise<void> {
    const cafe = await input.repository.findCafeForCampaign(input.cafeSlug);
    if (!cafe) throw new Error(`bootstrap ${input.cafeSlug}: café is missing`);
    if (
        cafe.campaign?.chainCampaignId !== null &&
        cafe.campaign?.chainCampaignId !== undefined
    )
        return;
    if (cafe.chainCafeId === null) {
        throw new Error(
            `bootstrap ${input.cafeSlug}: chain café id is missing`,
        );
    }
    if (cafe.ownerWalletIndex === null || !cafe.ownerWalletAddress) {
        throw new Error(`bootstrap ${input.cafeSlug}: owner wallet is missing`);
    }
    const owner = input.chain.ownerAddressForIndex(cafe.ownerWalletIndex);
    if (!sameAddress(owner, cafe.ownerWalletAddress)) {
        throw new Error(
            `bootstrap ${input.cafeSlug}: DB owner does not match derived owner`,
        );
    }
    const insertValues = demoCampaignValues(Date.now(), cafe.id);
    const campaign =
        cafe.campaign ??
        (await input.repository.insertDemoCampaign({
            cafeId: cafe.id,
            values: insertValues,
            voucherPayout: insertValues.voucherPayout,
            maxVouchers: insertValues.maxVouchers,
        }));
    if (campaign.chainCampaignId !== null) return;
    if (campaign.voucherPayout === null || campaign.maxVouchers === null) {
        throw new Error(
            `bootstrap ${input.cafeSlug}: campaign payout and cap are missing`,
        );
    }
    const budget = campaign.voucherPayout * BigInt(campaign.maxVouchers);
    await input.chain.mint({
        to: owner,
        amount: budget,
        signer: input.chain.deployerAddress,
    });
    const created = await input.chain.createCampaign({
        sourceCafeId: BigInt(cafe.chainCafeId),
        signer: input.chain.opsAddress,
    });
    if (created.receipt.status !== "success")
        throw new Error("bootstrap campaign create reverted");
    const chainCampaignId = input.chain.parseCreatedCampaignId(created.receipt);
    if (chainCampaignId === null || chainCampaignId > 2_147_483_647n) {
        throw new Error(
            "bootstrap campaign create receipt has invalid campaign id",
        );
    }
    await input.repository.linkCampaign({
        campaignId: campaign.id,
        chainCampaignId: Number(chainCampaignId),
    });
    await input.chain.approve({
        spender: input.chain.addresses.campaignEscrow,
        amount: budget,
        signer: owner,
    });
    await input.chain.fundCampaign({
        campaignId: chainCampaignId,
        amount: budget,
        signer: owner,
    });
    await input.chain.publishCampaign({
        campaignId: chainCampaignId,
        voucherPayout: campaign.voucherPayout,
        maxVouchers: BigInt(campaign.maxVouchers),
        expiry: BigInt(Math.floor(campaign.windowEnd.getTime() / 1000)),
        signer: input.chain.opsAddress,
    });
}

export async function bootstrapApprovedSeedCafes(input: {
    repository: BootstrapRepository;
    chain: BootstrapChain;
}): Promise<void> {
    const cafes = (await input.repository.listApprovedSeedCafes()).sort(
        (a, b) => a.slug.localeCompare(b.slug),
    );
    const cafeCount = await input.chain.countCafes();

    for (const cafe of cafes) {
        if (cafe.ownerWalletIndex === null || !cafe.ownerWalletAddress) {
            throw new Error(`bootstrap ${cafe.slug}: owner wallet is missing`);
        }
        const ownerAddress = input.chain.ownerAddressForIndex(
            cafe.ownerWalletIndex,
        );
        if (!sameAddress(ownerAddress, cafe.ownerWalletAddress)) {
            throw new Error(
                `bootstrap ${cafe.slug}: DB owner does not match derived owner`,
            );
        }

        const products = cafe.products
            .filter(
                (product) =>
                    product.type === "emission" &&
                    product.approvalStatus === "approved" &&
                    product.active,
            )
            .sort((a, b) => {
                const createdAt =
                    (a.createdAt?.getTime() ?? 0) -
                    (b.createdAt?.getTime() ?? 0);
                return createdAt || a.id.localeCompare(b.id);
            });
        const eligibleProductIds = products.map((product, index) =>
            BigInt(product.chainProductId ?? index + 1),
        );
        let chainCafeId: bigint;
        let chainProductIds = eligibleProductIds;

        if (cafe.chainCafeId !== null) {
            chainCafeId = BigInt(cafe.chainCafeId);
            const live = await input.chain.inspectCafe(chainCafeId);
            if (!live)
                throw new Error(
                    `bootstrap ${cafe.slug}: mapped café is missing on chain`,
                );
            if (!sameAddress(live.ownerAddress, ownerAddress)) {
                throw new Error(
                    `bootstrap ${cafe.slug}: mapped café owner mismatch`,
                );
            }
            await input.chain.verifyCafe({
                chainCafeId,
                ownerAddress,
                eligibleProductIds,
            });
            const recoveredProductIds = live.eligibleProductIds.map((id) =>
                Number(id),
            );
            const needsBackfill = products.some(
                (product, index) =>
                    product.chainProductId !== recoveredProductIds[index],
            );
            if (needsBackfill) {
                await input.repository.persistCafeMappings({
                    cafeId: cafe.id,
                    chainCafeId: Number(chainCafeId),
                    products: products.map((product, index) => ({
                        productId: product.id,
                        chainProductId: recoveredProductIds[index] ?? index + 1,
                    })),
                });
            }
            await authorizeOperators({
                chain: input.chain,
                chainCafeId,
                addresses: cafe.operatorWalletAddresses,
            });
            continue;
        }

        let recovered: LiveCafe | null = null;
        for (let id = 1n; id <= cafeCount; id++) {
            const live = await input.chain.inspectCafe(id);
            if (live && sameAddress(live.ownerAddress, ownerAddress)) {
                recovered = live;
                break;
            }
        }
        if (recovered) {
            chainCafeId = recovered.chainCafeId;
            chainProductIds = eligibleProductIds;
            await input.chain.verifyCafe({
                chainCafeId,
                ownerAddress,
                eligibleProductIds,
            });
        } else {
            const seeded = await input.chain.seedCafe({
                ownerWalletIndex: cafe.ownerWalletIndex,
                eligibleProductIds,
            });
            chainCafeId = seeded.chainCafeId;
            chainProductIds = seeded.eligibleProductIds;
            await input.chain.verifyCafe({
                chainCafeId,
                ownerAddress,
                eligibleProductIds,
            });
        }

        await input.repository.persistCafeMappings({
            cafeId: cafe.id,
            chainCafeId: Number(chainCafeId),
            products: products.map((product, index) => ({
                productId: product.id,
                chainProductId: Number(chainProductIds[index]),
            })),
        });
        await authorizeOperators({
            chain: input.chain,
            chainCafeId,
            addresses: cafe.operatorWalletAddresses,
        });
    }
}
