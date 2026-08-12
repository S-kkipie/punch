import "server-only";

import { eq } from "drizzle-orm";
import type { PublicClient } from "viem";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";
import {
    fetchEvents,
    runIndexerOnce,
} from "@/core/chain/server/indexer/indexer";
import { db } from "@/server/drizzle/db";
import {
    indexerCursor,
    projectionCafeCredit,
    projectionConsumption,
    projectionPunchBalance,
    projectionStatus,
} from "@/server/drizzle/schemas/chain-schema";
import { clearChainDerivedPurchaseProjections } from "./purchase-projection-rebuild";

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

async function readChainState(deps: ReconcilerDeps): Promise<{
    punchBalance: bigint;
    credits: Map<number, bigint>;
    consumptionCount: number;
}> {
    const punchBalance = (await deps.pub.readContract({
        address: deps.addresses.punchVault,
        abi: abis.punchVault,
        functionName: "totalLivePunch",
    })) as bigint;

    const latest = await deps.pub.getBlockNumber({ cacheTime: 0 });
    const events = await fetchEvents(
        {
            pub: deps.pub,
            database: deps.database,
            addresses: deps.addresses,
        },
        0n,
        latest,
    );

    const cafeIds = new Set<number>();
    let consumptionCount = 0;
    for (const event of events) {
        if (event.eventName === "ConsumptionRecorded") {
            consumptionCount += 1;
            continue;
        }
        if (
            (event.eventName === "PlanActivated" ||
                event.eventName === "PackPurchased") &&
            typeof event.args.cafeId !== "undefined"
        ) {
            cafeIds.add(Number(event.args.cafeId));
        }
    }

    const creditEntries = await Promise.all(
        [...cafeIds].map(async (chainCafeId) => {
            const credits = (await deps.pub.readContract({
                address: deps.addresses.planManager,
                abi: abis.planManager,
                functionName: "credits",
                args: [BigInt(chainCafeId)],
            })) as bigint;
            return [chainCafeId, credits] as const;
        }),
    );

    return {
        punchBalance,
        credits: new Map(creditEntries),
        consumptionCount,
    };
}

function matches(
    projection: ProjectionState,
    chain: Awaited<ReturnType<typeof readChainState>>,
): boolean {
    if (projection.punchBalance !== chain.punchBalance) return false;
    if (projection.consumptionCount !== chain.consumptionCount) return false;
    if (projection.credits.length !== chain.credits.size) return false;
    const projectionCredits = new Map(
        projection.credits.map(
            (row) => [row.chainCafeId, row.credits] as const,
        ),
    );
    if (projectionCredits.size !== chain.credits.size) return false;
    for (const [chainCafeId, credits] of chain.credits) {
        if (projectionCredits.get(chainCafeId) !== credits) return false;
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

export async function runReconcilerOnce(
    deps: ReconcilerDeps = defaultDeps(),
): Promise<{ diverged: boolean; repaired: boolean }> {
    // El chequeo recorre la cadena entera desde el bloque 0 para contar
    // eventos. En Anvil son cientos de bloques; en una red pública son
    // cientos de millones, así que el conteo nunca cuadra y el "arreglo"
    // borra proyecciones buenas sin poder reconstruirlas. Solo corre en local.
    if ((process.env.CHAIN_ENV ?? "local") !== "local") {
        return { diverged: false, repaired: false };
    }
    const projection = await readProjectionState(deps.database);
    const chain = await readChainState(deps);
    if (matches(projection, chain)) {
        await setPaused(deps.database, false, projection.cursor);
        return { diverged: false, repaired: false };
    }

    await setPaused(deps.database, true);
    try {
        await clearChainDerivedPurchaseProjections(deps.database);
        await (deps.runIndexer ?? runIndexerOnce)({
            pub: deps.pub,
            database: deps.database,
            addresses: deps.addresses,
            force: true,
        });
        const repairedProjection = await readProjectionState(deps.database);
        const repairedChain = await readChainState(deps);
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
    return rows[0]?.paused ?? true;
}
