import "server-only";

import { eq } from "drizzle-orm";
import { getAbiItem, type PublicClient } from "viem";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import { db } from "@/server/drizzle/db";
import {
    indexerCursor,
    projectionCafeCredit,
    projectionConsumption,
    projectionPunchBalance,
    projectionStatus,
} from "@/server/drizzle/schemas/chain-schema";

export type ReconcilerDeps = {
    pub: Pick<PublicClient, "getBlockNumber" | "getLogs" | "readContract">;
    database: typeof db;
    addresses: ReturnType<typeof getAddresses>;
    runIndexer?: typeof runIndexerOnce;
};

type ProjectionState = {
    cursor: bigint;
    punchBalance: bigint;
    credits: Array<{ chainCafeId: number; credits: bigint }>;
    consumptionCount: number;
};

function defaultDeps(): ReconcilerDeps {
    return {
        pub: createChainPublicClient(),
        database: db,
        addresses: getAddresses(),
    };
}

async function readProjectionState(
    database: typeof db,
): Promise<ProjectionState> {
    const [cursorRows, balances, credits, consumptions] = await Promise.all([
        database
            .select({ block: indexerCursor.lastProcessedBlock })
            .from(indexerCursor)
            .where(eq(indexerCursor.contract, "punch")),
        database
            .select({ balance: projectionPunchBalance.balance })
            .from(projectionPunchBalance),
        database
            .select({
                chainCafeId: projectionCafeCredit.chainCafeId,
                credits: projectionCafeCredit.credits,
            })
            .from(projectionCafeCredit),
        database
            .select({ id: projectionConsumption.id })
            .from(projectionConsumption),
    ]);

    return {
        cursor: cursorRows[0]?.block ?? 0n,
        punchBalance: balances.reduce((sum, row) => sum + row.balance, 0n),
        credits,
        consumptionCount: consumptions.length,
    };
}

async function readChainState(
    deps: ReconcilerDeps,
    projection: ProjectionState,
): Promise<{
    punchBalance: bigint;
    credits: Map<number, bigint>;
    consumptionCount: number;
}> {
    const punchBalance = (await deps.pub.readContract({
        address: deps.addresses.punchVault,
        abi: abis.punchVault,
        functionName: "totalLivePunch",
    })) as bigint;

    const creditEntries = await Promise.all(
        projection.credits.map(async ({ chainCafeId }) => {
            const credits = (await deps.pub.readContract({
                address: deps.addresses.planManager,
                abi: abis.planManager,
                functionName: "credits",
                args: [BigInt(chainCafeId)],
            })) as bigint;
            return [chainCafeId, credits] as const;
        }),
    );

    const event = getAbiItem({
        abi: abis.consumptionLog,
        name: "ConsumptionRecorded",
    });
    if (event?.type !== "event") {
        throw new Error("missing ConsumptionRecorded ABI event");
    }
    const latest = await deps.pub.getBlockNumber();
    const logs = await deps.pub.getLogs({
        address: deps.addresses.consumptionLog,
        event,
        fromBlock: 0n,
        toBlock: latest,
    });

    return {
        punchBalance,
        credits: new Map(creditEntries),
        consumptionCount: logs.length,
    };
}

function matches(
    projection: ProjectionState,
    chain: Awaited<ReturnType<typeof readChainState>>,
): boolean {
    if (projection.punchBalance !== chain.punchBalance) return false;
    if (projection.consumptionCount !== chain.consumptionCount) return false;
    for (const row of projection.credits) {
        if (chain.credits.get(row.chainCafeId) !== row.credits) return false;
    }
    return true;
}

async function setPaused(
    database: typeof db,
    paused: boolean,
    lastGoodBlock?: bigint,
) {
    const values = {
        projection: "chain" as const,
        paused,
        ...(lastGoodBlock === undefined ? {} : { lastGoodBlock }),
    };
    await database
        .insert(projectionStatus)
        .values(values)
        .onConflictDoUpdate({
            target: projectionStatus.projection,
            set: {
                paused,
                ...(lastGoodBlock === undefined ? {} : { lastGoodBlock }),
            },
        });
}

async function wipeProjections(database: typeof db): Promise<void> {
    await database.transaction(async (tx) => {
        await tx.delete(projectionPunchBalance);
        await tx.delete(projectionCafeCredit);
        await tx.delete(projectionConsumption);
        await tx
            .insert(indexerCursor)
            .values({ contract: "punch", lastProcessedBlock: 0n })
            .onConflictDoUpdate({
                target: indexerCursor.contract,
                set: { lastProcessedBlock: 0n },
            });
        await tx
            .insert(projectionStatus)
            .values({ projection: "chain", paused: true, lastGoodBlock: 0n })
            .onConflictDoUpdate({
                target: projectionStatus.projection,
                set: { paused: true },
            });
    });
}

export async function runReconcilerOnce(
    deps: ReconcilerDeps = defaultDeps(),
): Promise<{ diverged: boolean; repaired: boolean }> {
    const projection = await readProjectionState(deps.database);
    const chain = await readChainState(deps, projection);
    if (matches(projection, chain)) {
        await setPaused(deps.database, false, projection.cursor);
        return { diverged: false, repaired: false };
    }

    await setPaused(deps.database, true);
    try {
        await wipeProjections(deps.database);
        await (deps.runIndexer ?? runIndexerOnce)({
            pub: deps.pub,
            database: deps.database,
            addresses: deps.addresses,
            force: true,
        });
        const repairedProjection = await readProjectionState(deps.database);
        const repairedChain = await readChainState(deps, repairedProjection);
        if (!matches(repairedProjection, repairedChain)) {
            console.error("chain projection reconciliation remains divergent");
            return { diverged: true, repaired: false };
        }
        await setPaused(deps.database, false, repairedProjection.cursor);
        console.warn("chain projection drift repaired");
        return { diverged: true, repaired: true };
    } catch (error) {
        await setPaused(deps.database, true);
        console.error("chain projection reconciliation failed");
        throw error;
    }
}

export async function isChainProjectionStale(
    database: typeof db = db,
): Promise<boolean> {
    const rows = await database
        .select({ paused: projectionStatus.paused })
        .from(projectionStatus)
        .where(eq(projectionStatus.projection, "chain"));
    return rows[0]?.paused ?? false;
}
