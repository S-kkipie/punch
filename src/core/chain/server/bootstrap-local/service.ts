import "server-only";

export type EligibleProduct = {
    productId: bigint;
    kind: 0 | 1;
};

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
    eligibleProducts: EligibleProduct[];
    planActive: boolean;
    credits: bigint;
};

export type BootstrapChain = {
    ownerAddressForIndex(index: number): `0x${string}`;
    countCafes(): Promise<bigint>;
    inspectCafe(chainCafeId: bigint): Promise<LiveCafe | null>;
    ensureEligibleProducts(input: {
        chainCafeId: bigint;
        ownerWalletIndex: number;
        eligibleProducts: EligibleProduct[];
    }): Promise<void>;
    seedCafe(input: {
        ownerWalletIndex: number;
        eligibleProducts: EligibleProduct[];
    }): Promise<{
        chainCafeId: bigint;
        ownerAddress: `0x${string}`;
        eligibleProducts: EligibleProduct[];
    }>;
    verifyCafe(input: {
        chainCafeId: bigint;
        ownerAddress: `0x${string}`;
        eligibleProducts: EligibleProduct[];
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
                    (product.type === "emission" ||
                        product.type === "reward") &&
                    product.approvalStatus === "approved" &&
                    product.active,
            )
            .sort((a, b) => {
                const createdAt =
                    (a.createdAt?.getTime() ?? 0) -
                    (b.createdAt?.getTime() ?? 0);
                return createdAt || a.id.localeCompare(b.id);
            });
        const emissions = products.filter(
            (product) => product.type === "emission",
        );
        const rewards = products.filter((product) => product.type === "reward");
        const eligibleProducts = [...emissions, ...rewards].map(
            (product, index) => ({
                productId: BigInt(product.chainProductId ?? index + 1),
                kind: product.type === "emission" ? (0 as const) : (1 as const),
            }),
        );
        let chainCafeId: bigint;
        let chainProducts = eligibleProducts;

        if (cafe.chainCafeId !== null) {
            chainCafeId = BigInt(cafe.chainCafeId);
            let live = await input.chain.inspectCafe(chainCafeId);
            if (!live)
                throw new Error(
                    `bootstrap ${cafe.slug}: mapped café is missing on chain`,
                );
            if (!sameAddress(live.ownerAddress, ownerAddress)) {
                throw new Error(
                    `bootstrap ${cafe.slug}: mapped café owner mismatch`,
                );
            }
            await input.chain.ensureEligibleProducts({
                chainCafeId,
                ownerWalletIndex: cafe.ownerWalletIndex,
                eligibleProducts,
            });
            live = await input.chain.inspectCafe(chainCafeId);
            if (!live)
                throw new Error(
                    `bootstrap ${cafe.slug}: café disappeared after repair`,
                );
            await input.chain.verifyCafe({
                chainCafeId,
                ownerAddress,
                eligibleProducts,
            });
            const recoveredProducts = live.eligibleProducts;
            const orderedProducts = [...emissions, ...rewards];
            const needsBackfill =
                orderedProducts.some(
                    (product, index) =>
                        product.chainProductId !==
                        Number(recoveredProducts[index]?.productId),
                ) ||
                eligibleProducts.some(
                    (product, index) =>
                        product.productId !==
                            recoveredProducts[index]?.productId ||
                        product.kind !== recoveredProducts[index]?.kind,
                );
            if (needsBackfill) {
                await input.repository.persistCafeMappings({
                    cafeId: cafe.id,
                    chainCafeId: Number(chainCafeId),
                    products: [...emissions, ...rewards].map(
                        (product, index) => ({
                            productId: product.id,
                            chainProductId: Number(
                                recoveredProducts[index]?.productId ??
                                    index + 1,
                            ),
                        }),
                    ),
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
            await input.chain.ensureEligibleProducts({
                chainCafeId,
                ownerWalletIndex: cafe.ownerWalletIndex,
                eligibleProducts,
            });
            const repaired = await input.chain.inspectCafe(chainCafeId);
            if (!repaired)
                throw new Error(
                    `bootstrap ${cafe.slug}: café disappeared after repair`,
                );
            chainProducts = repaired.eligibleProducts;
            await input.chain.verifyCafe({
                chainCafeId,
                ownerAddress,
                eligibleProducts,
            });
        } else {
            const seeded = await input.chain.seedCafe({
                ownerWalletIndex: cafe.ownerWalletIndex,
                eligibleProducts,
            });
            chainCafeId = seeded.chainCafeId;
            chainProducts = seeded.eligibleProducts;
            await input.chain.ensureEligibleProducts({
                chainCafeId,
                ownerWalletIndex: cafe.ownerWalletIndex,
                eligibleProducts,
            });
            await input.chain.verifyCafe({
                chainCafeId,
                ownerAddress,
                eligibleProducts,
            });
        }

        await input.repository.persistCafeMappings({
            cafeId: cafe.id,
            chainCafeId: Number(chainCafeId),
            products: [...emissions, ...rewards].map((product, index) => ({
                productId: product.id,
                chainProductId: Number(chainProducts[index].productId),
            })),
        });
        await authorizeOperators({
            chain: input.chain,
            chainCafeId,
            addresses: cafe.operatorWalletAddresses,
        });
    }
}
