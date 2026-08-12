import "server-only";

import { eq } from "drizzle-orm";
import {
    decodeEventLog,
    encodeEventTopics,
    getAbiItem,
    type Hex,
    type Log,
    type PublicClient,
} from "viem";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";
import { db } from "@/server/drizzle/db";
import {
    indexerCursor,
    projectionStatus,
} from "@/server/drizzle/schemas/chain-schema";
import {
    applyEvent,
    type IndexerEvent,
    type IndexerTransaction,
} from "./apply-event";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ContractName = keyof ReturnType<typeof getAddresses>;

type Source = {
    addressKey: ContractName;
    selectors: Map<Hex, IndexerEvent["eventName"]>;
    events: Map<IndexerEvent["eventName"], readonly unknown[]>;
};

export type IndexerDeps = {
    pub: Pick<PublicClient, "getBlockNumber" | "getLogs">;
    database: typeof db;
    addresses: ReturnType<typeof getAddresses>;
    deployBlock?: bigint;
    apply?: (tx: IndexerTransaction, event: IndexerEvent) => Promise<void>;
    /** Permit a repair reindex while the projection remains paused. */
    force?: boolean;
};

function source(
    addressKey: ContractName,
    abi: readonly unknown[],
    eventNames: readonly IndexerEvent["eventName"][],
): Source {
    const selectors = new Map<Hex, IndexerEvent["eventName"]>();
    const events = new Map<IndexerEvent["eventName"], readonly unknown[]>();
    for (const eventName of eventNames) {
        const item = getAbiItem({ abi, name: eventName });
        if (item?.type !== "event") {
            throw new Error(`missing ABI event ${eventName}`);
        }
        selectors.set(
            encodeEventTopics({ abi: [item], eventName: item.name })[0] as Hex,
            eventName,
        );
        events.set(eventName, [item]);
    }
    return { addressKey, selectors, events };
}

const sources = [
    source("punchVault", abis.punchVault, ["PunchIssued", "RewardRedeemed"]),
    source("consumptionLog", abis.consumptionLog, ["ConsumptionRecorded"]),
    source("planManager", abis.planManager, [
        "EmissionCreditConsumed",
        "PlanActivated",
        "PackPurchased",
    ]),
    source("campaignEscrow", abis.campaignEscrow, [
        "CampaignCreated",
        "CampaignFunded",
        "CampaignPublished",
        "CampaignCancelled",
        "VoucherUnlocked",
        "VoucherRedeemed",
    ]),
] as const;

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

function orderingMetadata(log: Log) {
    if (
        log.blockNumber === null ||
        log.blockNumber === undefined ||
        log.transactionHash === null ||
        log.transactionHash === undefined ||
        log.transactionIndex === null ||
        log.transactionIndex === undefined ||
        log.logIndex === null ||
        log.logIndex === undefined
    ) {
        throw new Error("chain event missing ordering metadata");
    }
    return {
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
    };
}

function decodeKnownLog(source: Source, log: Log): IndexerEvent | null {
    const selector = log.topics[0];
    if (!selector) return null;
    const eventName = source.selectors.get(selector as Hex);
    if (!eventName) return null;
    const eventAbi = source.events.get(eventName);
    if (!eventAbi) throw new Error(`missing decode ABI for ${eventName}`);
    const decoded = decodeEventLog({
        abi: eventAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
    });
    const metadata = orderingMetadata(log);
    return {
        eventName,
        args: decoded.args as Record<string, unknown>,
        blockNumber: metadata.blockNumber,
        transactionHash: metadata.transactionHash,
        transactionIndex: metadata.transactionIndex,
        logIndex: metadata.logIndex,
    };
}

async function fetchEvents(
    deps: IndexerDeps,
    fromBlock: bigint,
    toBlock: bigint,
): Promise<IndexerEvent[]> {
    const all: IndexerEvent[] = [];
    for (const item of sources) {
        const logs = await deps.pub.getLogs({
            address: deps.addresses[item.addressKey],
            fromBlock,
            toBlock,
        });
        for (const log of logs) {
            const event = decodeKnownLog(item, log);
            if (event) all.push(event);
        }
    }
    return sortEvents(all);
}

/**
 * Bloques que se leen como máximo por pasada. Los RPC públicos rechazan un
 * `getLogs` con un rango grande, y sin tope el indexador que se atrasa pide un
 * rango cada vez mayor: falla siempre, el cursor no avanza y la brecha crece
 * sola. Con este tope cada pasada avanza aunque venga rezagado.
 */
export const MAX_BLOCKS_PER_PASS = 2_000n;

export async function runIndexerOnce(
    deps: IndexerDeps = defaultDeps(),
): Promise<void> {
    const status = await deps.database
        .select({ paused: projectionStatus.paused })
        .from(projectionStatus)
        .where(eq(projectionStatus.projection, "chain"));
    if (status[0]?.paused && !deps.force) return;

    const cursorRows = await deps.database
        .select({ block: indexerCursor.lastProcessedBlock })
        .from(indexerCursor)
        .where(eq(indexerCursor.contract, "punch"));
    const cursor = cursorRows[0]?.block ?? deps.deployBlock ?? 0n;

    const head = await deps.pub.getBlockNumber({ cacheTime: 0 });
    if (head <= cursor) return;
    // Se avanza por tramos; el resto queda para la siguiente pasada.
    const latest =
        head - cursor > MAX_BLOCKS_PER_PASS
            ? cursor + MAX_BLOCKS_PER_PASS
            : head;

    const events = await fetchEvents(deps, cursor + 1n, latest);
    const apply = deps.apply ?? applyEvent;
    await deps.database.transaction(async (tx: Tx) => {
        for (const event of events) {
            await apply(tx, event);
        }
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
                paused: !!deps.force,
                lastGoodBlock: deps.force ? 0n : latest,
            })
            .onConflictDoUpdate({
                target: projectionStatus.projection,
                set: deps.force
                    ? { paused: true }
                    : { paused: false, lastGoodBlock: latest },
            });
    });
}

export { decodeKnownLog, fetchEvents, sortEvents };
