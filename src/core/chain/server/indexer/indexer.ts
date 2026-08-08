import "server-only";

import { eq } from "drizzle-orm";
import { type Address, type PublicClient, parseEventLogs } from "viem";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";
import { db } from "@/server/drizzle/db";
import {
    indexerCursor,
    projectionStatus,
} from "@/server/drizzle/schemas/chain-schema";
import { applyEvent, type IndexerEvent } from "./apply-event";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type IndexerDeps = {
    pub: Pick<PublicClient, "getBlockNumber" | "getLogs">;
    database: typeof db;
    addresses: ReturnType<typeof getAddresses>;
    deployBlock?: bigint;
};

const sources = [
    { addressKey: "punchVault", abi: abis.punchVault },
    { addressKey: "consumptionLog", abi: abis.consumptionLog },
    { addressKey: "planManager", abi: abis.planManager },
] as const;
const relevant = new Set([
    "PunchIssued",
    "ConsumptionRecorded",
    "EmissionCreditConsumed",
    "PlanActivated",
    "PackPurchased",
]);

function defaultDeps(): IndexerDeps {
    return {
        pub: createChainPublicClient(),
        database: db,
        addresses: getAddresses(),
    };
}
function sortEvents(events: IndexerEvent[]): IndexerEvent[] {
    return events.sort((a, b) =>
        a.blockNumber < b.blockNumber
            ? -1
            : a.blockNumber > b.blockNumber
              ? 1
              : a.transactionIndex - b.transactionIndex ||
                a.logIndex - b.logIndex,
    );
}

async function fetchEvents(
    deps: IndexerDeps,
    fromBlock: bigint,
    toBlock: bigint,
): Promise<IndexerEvent[]> {
    const all: IndexerEvent[] = [];
    for (const source of sources) {
        const logs = await deps.pub.getLogs({
            address: deps.addresses[source.addressKey] as Address,
            fromBlock,
            toBlock,
        });
        const parsed = parseEventLogs({
            abi: source.abi,
            logs,
            strict: true,
        }) as Array<{
            eventName: string;
            args: Record<string, unknown>;
            blockNumber?: bigint;
            transactionHash?: string;
            logIndex: number;
            transactionIndex?: number;
        }>;
        for (const event of parsed) {
            if (!relevant.has(event.eventName)) continue;
            if (
                event.blockNumber === undefined ||
                event.transactionHash === undefined ||
                event.transactionIndex === undefined
            )
                throw new Error("chain event missing ordering metadata");
            all.push({
                eventName: event.eventName as IndexerEvent["eventName"],
                args: event.args,
                blockNumber: event.blockNumber,
                transactionHash: event.transactionHash,
                logIndex: event.logIndex,
                transactionIndex: event.transactionIndex,
            });
        }
    }
    return sortEvents(all);
}

export async function runIndexerOnce(
    deps: IndexerDeps = defaultDeps(),
): Promise<void> {
    const status = await deps.database
        .select({ paused: projectionStatus.paused })
        .from(projectionStatus)
        .where(eq(projectionStatus.projection, "chain"));
    if (status[0]?.paused) return;
    const cursorRows = await deps.database
        .select({ block: indexerCursor.lastProcessedBlock })
        .from(indexerCursor)
        .where(eq(indexerCursor.contract, "punch"));
    const cursor = cursorRows[0]?.block ?? deps.deployBlock ?? 0n;
    const latest = await deps.pub.getBlockNumber();
    if (latest <= cursor) return;
    const events = await fetchEvents(deps, cursor + 1n, latest);
    await deps.database.transaction(async (tx: Tx) => {
        for (const event of events) await applyEvent(tx, event);
        await tx
            .insert(indexerCursor)
            .values({ contract: "punch", lastProcessedBlock: latest })
            .onConflictDoUpdate({
                target: indexerCursor.contract,
                set: { lastProcessedBlock: latest },
            });
        await tx
            .insert(projectionStatus)
            .values({
                projection: "chain",
                paused: false,
                lastGoodBlock: latest,
            })
            .onConflictDoUpdate({
                target: projectionStatus.projection,
                set: { lastGoodBlock: latest },
            });
    });
}

export { fetchEvents, sortEvents };
