import "server-only";

import { eq, inArray } from "drizzle-orm";
import {
    createPublicClient,
    createWalletClient,
    http,
    keccak256,
    type PublicClient,
    toBytes,
} from "viem";
import { foundry } from "viem/chains";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { buildReceiptHash, type ConsumptionProof, signProofAs } from "@/core/chain/server/proof/proof";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import { createQuote } from "@/core/consumption/server/repository/proofs";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { consumptionProof } from "@/server/drizzle/schemas/consumption-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import { bootstrapRepository } from "./repository";

type ChainIdClient = Pick<PublicClient, "getChainId">;

export async function assertLocalChain31337(
    publicClient: ChainIdClient,
): Promise<void> {
    const chainId = await publicClient.getChainId();
    if (chainId !== 31337) {
        throw new Error("demo seeding requires chain id 31337");
    }
    if (process.env.NODE_ENV === "production") {
        throw new Error("demo seeding requires development mode");
    }
}

/**
 * Guard for operations that are legitimate on a public chain (registering real
 * cafés) as opposed to seeding fabricated history, which stays 31337-only.
 */
export async function assertExpectedChain(
    publicClient: ChainIdClient,
    expectedChainId: number,
): Promise<void> {
    const chainId = await publicClient.getChainId();
    if (chainId !== expectedChainId) {
        throw new Error(
            `chain mismatch: CHAIN_RPC_URL reports chain id ${chainId} but CHAIN_ENV expects ${expectedChainId}`,
        );
    }
}

type HistoricalScheduleItem = {
    cafeId: string;
    chainProductId: bigint;
    productId: string;
    nonce: bigint;
    amount: bigint;
    utcDay: string;
};

export function buildHistoricalSchedule(input: {
    cafes: readonly {
        id: string;
        emissionProducts: readonly {
            chainProductId: bigint;
            productId: string;
        }[];
    }[];
    targetCafeId: string;
    count: number;
}): HistoricalScheduleItem[] {
    const cafes = input.cafes.filter(
        (cafe) =>
            cafe.id !== input.targetCafeId && cafe.emissionProducts.length > 0,
    );
    if (cafes.length === 0 || input.count < 0) {
        throw new Error("historical schedule has no approved source cafes");
    }

    const schedule: HistoricalScheduleItem[] = [];
    for (let i = 0; i < input.count; i++) {
        const cafe = cafes[i % cafes.length];
        const utcDay = `2026-01-${String(Math.floor(i / 3) + 1).padStart(2, "0")}`;
        const product = cafe.emissionProducts[i % cafe.emissionProducts.length];
        schedule.push({
            cafeId: cafe.id,
            chainProductId: product.chainProductId,
            productId: product.productId,
            nonce: BigInt(i + 1),
            amount: 8_000_000n,
            utcDay,
        });
    }
    return schedule;
}

async function advanceAnvilDay(
    publicClient: ReturnType<typeof createPublicClient>,
): Promise<void> {
    const block = await publicClient.getBlock();
    const nextUtcDay = (block.timestamp / 86_400n + 1n) * 86_400n + 1n;
    await publicClient.request({
        method: "evm_increaseTime",
        params: [Number(nextUtcDay - block.timestamp)],
    });
    await publicClient.request({ method: "evm_mine", params: [] });
}

export async function seedHistoricalConsumptions(input: {
    consumerUserId: string;
    count: 11;
    targetCafeId: string;
}): Promise<readonly `0x${string}`[]> {
    const rpcUrl = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
    const addresses = getAddresses();
    const publicClient = createPublicClient({
        chain: foundry,
        transport: http(rpcUrl),
    });
    await assertLocalChain31337(publicClient);

    const [consumer] = await db
        .select({
            walletIndex: user.walletIndex,
            walletAddress: user.walletAddress,
        })
        .from(user)
        .where(eq(user.id, input.consumerUserId));
    if (!consumer || consumer.walletIndex === null || !consumer.walletAddress) {
        throw new Error("historical seeding consumer wallet is missing");
    }
    const consumerAccount = deriveUserAccount(consumer.walletIndex);
    if (
        consumerAccount.address.toLowerCase() !==
        consumer.walletAddress.toLowerCase()
    ) {
        throw new Error(
            "historical seeding consumer wallet does not match derived wallet",
        );
    }

    const cafes = await bootstrapRepository.listApprovedSeedCafes();
    const target = cafes.find((cafe) => cafe.id === input.targetCafeId);
    if (!target) throw new Error("historical seeding target café is missing");
    const schedule = buildHistoricalSchedule({
        cafes: cafes.map((cafe) => ({
            id: cafe.id,
            emissionProducts: cafe.products
                .filter(
                    (product) =>
                        product.type === "emission" &&
                        product.approvalStatus === "approved" &&
                        product.active &&
                        product.chainProductId !== null,
                )
                .map((product) => ({
                    chainProductId: BigInt(product.chainProductId as number),
                    productId: product.id,
                })),
        })),
        targetCafeId: input.targetCafeId,
        count: input.count,
    });

    const ownerWalletIndexes = Array.from(
        new Set(
            cafes
                .map((cafe) => cafe.ownerWalletIndex)
                .filter((walletIndex): walletIndex is number => walletIndex !== null),
        ),
    );
    if (ownerWalletIndexes.length === 0) {
        throw new Error("historical seeding has no owner wallets");
    }
    const ownerRows = await db
        .select({ id: user.id, walletIndex: user.walletIndex })
        .from(user)
        .where(inArray(user.walletIndex, ownerWalletIndexes));
    const ownerUserByWalletIndex = new Map<number, string>(
        ownerRows
            .filter(
                (row): row is { id: string; walletIndex: number } =>
                    row.walletIndex !== null,
            )
            .map((row) => [row.walletIndex, row.id]),
    );

    const currentBalance = (await publicClient.readContract({
        address: addresses.punchVault,
        abi: abis.punchVault,
        functionName: "balanceOf",
        args: [consumerAccount.address],
    })) as bigint;
    if (currentBalance !== 0n) {
        throw new Error(
            `historical seeding already seeded or has existing balance ${currentBalance}`,
        );
    }
    if (target.chainCafeId === null) {
        throw new Error("historical seeding target café has no chain mapping");
    }
    const topic = (value: string) =>
        `0x${value.replace(/^0x/, "").padStart(64, "0")}`.toLowerCase();
    const targetUserTopic = topic(consumerAccount.address);
    const targetCafeTopic = topic(BigInt(target.chainCafeId).toString(16));
    const targetPurchases = await publicClient.getLogs({
        address: addresses.punchVault,
        fromBlock: 0n,
    });
    const targetPurchaseCount = targetPurchases.filter(
        (log) =>
            log.topics[0] ===
                keccak256(toBytes("PunchIssued(address,uint256)")) &&
            log.topics[1]?.toLowerCase() === targetUserTopic.toLowerCase() &&
            log.topics[2]?.toLowerCase() === targetCafeTopic.toLowerCase(),
    ).length;
    if (targetPurchaseCount > 0) {
        throw new Error(
            "historical seeding target café already has a consumer purchase",
        );
    }

    const cafeById = new Map(cafes.map((cafe) => [cafe.id, cafe]));
    for (const cafe of cafes) {
        if (cafe.chainCafeId === null || cafe.ownerWalletIndex === null) {
            throw new Error(
                `historical seeding ${cafe.slug}: chain mapping is missing`,
            );
        }
        const liveCredits = (await publicClient.readContract({
            address: addresses.planManager,
            abi: abis.planManager,
            functionName: "credits",
            args: [BigInt(cafe.chainCafeId)],
        })) as bigint;
        const required = BigInt(
            schedule.filter((item) => item.cafeId === cafe.id).length,
        );
        if (liveCredits < required) {
            throw new Error(
                `historical seeding ${cafe.slug}: requires ${required} credits, has ${liveCredits}`,
            );
        }
    }
    const [totalLivePunch, vaultReserve] = await Promise.all([
        publicClient.readContract({
            address: addresses.punchVault,
            abi: abis.punchVault,
            functionName: "totalLivePunch",
        }) as Promise<bigint>,
        publicClient.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [addresses.punchVault],
        }) as Promise<bigint>,
    ]);
    const scheduledCafeIds = [
        ...new Set(
            schedule.map((item) => cafeById.get(item.cafeId)?.chainCafeId),
        ),
    ].filter((id): id is number => id !== undefined && id !== null);
    const planReserve = await Promise.all(
        scheduledCafeIds.map(
            (chainCafeId) =>
                publicClient.readContract({
                    address: addresses.planManager,
                    abi: abis.planManager,
                    functionName: "unallocatedReserve",
                    args: [BigInt(chainCafeId)],
                }) as Promise<bigint>,
        ),
    );
    const availableReserve =
        vaultReserve + planReserve.reduce((total, value) => total + value, 0n);
    const requiredReserve = (totalLivePunch + BigInt(input.count)) * 300_000n;
    if (availableReserve < requiredReserve) {
        throw new Error(
            `historical seeding: reserve coverage insufficient (requires ${requiredReserve}, has ${availableReserve})`,
        );
    }

    const submitter = createWalletClient({
        account: consumerAccount,
        chain: foundry,
        transport: http(rpcUrl),
    });
    const hashes: `0x${string}`[] = [];
    let previousDay: string | undefined;
    for (const item of schedule) {
        if (previousDay !== undefined && item.utcDay !== previousDay) {
            await advanceAnvilDay(publicClient);
        }
        previousDay = item.utcDay;
        const cafe = cafeById.get(item.cafeId);
        if (!cafe?.chainCafeId || cafe.ownerWalletIndex === null) {
            throw new Error(
                `historical seeding ${item.cafeId}: operator is missing`,
            );
        }

        const issuedByUserId = ownerUserByWalletIndex.get(cafe.ownerWalletIndex);
        if (!issuedByUserId) {
            throw new Error(
                `historical seeding ${item.cafeId}: owner user id is missing`,
            );
        }

        const now = (await publicClient.getBlock()).timestamp;
        const orderId = crypto.randomUUID();
        const yapeRef = `demo-${item.nonce}`;
        const receiptHash = buildReceiptHash(orderId, yapeRef);
        const proof: ConsumptionProof = {
            cafeId: BigInt(cafe.chainCafeId),
            user: consumerAccount.address,
            productId: item.chainProductId,
            amount: item.amount,
            receiptHash,
            nonce: item.nonce,
            expiry: now + 900n,
        };
        const [cafeSignature, userSignature] = await Promise.all([
            signProofAs(cafe.ownerWalletIndex, proof),
            signProofAs(consumer.walletIndex, proof),
        ]);

        await db.transaction(async (tx) => {
            const quoteRow = await createQuote(
                {
                    cafeId: cafe.id,
                    productId: item.productId,
                    issuedByUserId,
                    amountCentimos: Number(item.amount / 10_000n),
                    yapeRef,
                    status: "issued",
                    expiresAt: new Date(Number(now + 900n) * 1000),
                    receiptHash: null,
                    nonce: null,
                    cafeSignature: null,
                    consumerSignature: null,
                    consumerUserId: null,
                    failureReason: null,
                    purchaseOrderId: null,
                },
                tx,
            );

            const [order] = await tx
                .insert(purchaseOrder)
                .values({
                    id: orderId,
                    cafeId: cafe.id,
                    userId: input.consumerUserId,
                    productId: item.productId,
                    amount: item.amount,
                    yapeRef,
                    receiptHash,
                    nonce: item.nonce.toString(),
                    expiry: new Date(Number(now + 900n) * 1000),
                    status: "queued",
                })
                .returning();

            if (!order) {
                throw new Error(
                    `historical seeding ${item.cafeId}: queued order was not created`,
                );
            }

            await tx
                .update(consumptionProof)
                .set({
                    consumerUserId: input.consumerUserId,
                    purchaseOrderId: order.id,
                    receiptHash,
                    nonce: item.nonce.toString(),
                    cafeSignature,
                    consumerSignature: userSignature,
                    status: "submitted",
                })
                .where(eq(consumptionProof.id, quoteRow.id));
        });

        const hash = await submitter.writeContract({
            address: addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [proof, cafeSignature, userSignature],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
            throw new Error(
                `historical seeding consumption reverted for ${item.cafeId}: ${hash}`,
            );
        }
        hashes.push(hash);
    }

    const finalBalance = (await publicClient.readContract({
        address: addresses.punchVault,
        abi: abis.punchVault,
        functionName: "balanceOf",
        args: [consumerAccount.address],
    })) as bigint;
    if (finalBalance !== 11n) {
        throw new Error(
            `historical seeding final on-chain balance expected 11, got ${finalBalance}`,
        );
    }
    return hashes;
}
