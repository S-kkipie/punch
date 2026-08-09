import "server-only";

import type { PublicClient } from "viem";

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

export type HistoricalScheduleItem = {
    cafeId: string;
    productId: bigint;
    nonce: bigint;
    amount: bigint;
    utcDay: string;
};

export function buildHistoricalSchedule(input: {
    cafes: readonly { id: string; emissionProductIds: readonly bigint[] }[];
    targetCafeId: string;
    count: number;
}): HistoricalScheduleItem[] {
    const cafes = input.cafes.filter(
        (cafe) =>
            cafe.id !== input.targetCafeId &&
            cafe.emissionProductIds.length > 0,
    );
    if (cafes.length === 0 || input.count < 0) {
        throw new Error("historical schedule has no approved source cafes");
    }

    const schedule: HistoricalScheduleItem[] = [];
    for (let i = 0; i < input.count; i++) {
        const cafe = cafes[i % cafes.length];
        const utcDay = `2026-01-${String(Math.floor(i / 3) + 1).padStart(2, "0")}`;
        schedule.push({
            cafeId: cafe.id,
            productId:
                cafe.emissionProductIds[i % cafe.emissionProductIds.length],
            nonce: BigInt(i + 1),
            amount: 8_000_000n,
            utcDay,
        });
    }
    return schedule;
}
