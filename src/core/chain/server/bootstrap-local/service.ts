import "server-only";

export type BootstrapProduct = {
    id: string;
    chainProductId: number | null;
    createdAt?: Date;
    type: "emission" | "reward";
};

export type ApprovedSeedCafe = {
    id: string;
    slug: string;
    chainCafeId: number | null;
    ownerWalletIndex: number | null;
    ownerWalletAddress: string | null;
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
};

function sameAddress(a: string, b: string) {
    return a.toLowerCase() === b.toLowerCase();
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
            .filter((product) => product.type === "emission")
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
    }
}
