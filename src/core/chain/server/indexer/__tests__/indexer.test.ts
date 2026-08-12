// biome-ignore-all lint/suspicious/noExplicitAny: lightweight indexer test doubles intentionally mirror loose client/db surfaces

import {
    encodeAbiParameters,
    encodeEventTopics,
    getAbiItem,
    type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import { abis } from "@/core/chain/abis";
import {
    indexerCursor,
    projectionStatus,
} from "@/server/drizzle/schemas/chain-schema";
import type { IndexerEvent } from "../apply-event";
import {
    fetchEvents,
    MAX_BLOCKS_PER_PASS,
    runIndexerOnce,
    sortEvents,
} from "../indexer";

const addresses = {
    cafeRegistry: "0x1000000000000000000000000000000000000001",
    planManager: "0x1000000000000000000000000000000000000002",
    consumptionLog: "0x1000000000000000000000000000000000000003",
    punchVault: "0x1000000000000000000000000000000000000004",
    networkFund: "0x1000000000000000000000000000000000000005",
    campaignEscrow: "0x1000000000000000000000000000000000000006",
    mockPEN: "0x1000000000000000000000000000000000000007",
} as const;

function topicData(
    abi: readonly unknown[],
    eventName: string,
    args: Record<string, unknown>,
) {
    const item = getAbiItem({ abi, name: eventName });
    if (item?.type !== "event") throw new Error(`missing ${eventName}`);
    const topics = encodeEventTopics({
        abi: [item],
        eventName: item.name,
        args,
    });
    const dataInputs = item.inputs.filter((input) => !input.indexed);
    const dataValues = dataInputs.map((input) => {
        if (!input.name) throw new Error(`unnamed input on ${eventName}`);
        return args[input.name];
    });
    const data =
        dataInputs.length === 0
            ? ("0x" as Hex)
            : encodeAbiParameters(dataInputs, dataValues);
    return { topics, data };
}

function rawLog(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    eventName: string;
    eventArgs: Record<string, unknown>;
    blockNumber: bigint;
    transactionIndex: number;
    logIndex: number;
    transactionHash: `0x${string}`;
    topics?: readonly Hex[];
    data?: Hex;
}) {
    const encoded = topicData(args.abi, args.eventName, args.eventArgs);
    return {
        address: args.address,
        blockHash:
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        blockNumber: args.blockNumber,
        data: args.data ?? encoded.data,
        logIndex: args.logIndex,
        removed: false,
        topics: (args.topics ?? encoded.topics) as readonly Hex[],
        transactionHash: args.transactionHash,
        transactionIndex: args.transactionIndex,
    } as const;
}

function fakeDatabase(state: {
    paused?: boolean;
    cursor?: bigint;
    txCount?: number;
}) {
    const db = {
        txCount: state.txCount ?? 0,
        cursorWrites: 0,
        statusWrites: 0,
        select(_fields: unknown) {
            return {
                from(table: unknown) {
                    return {
                        where() {
                            if (table === projectionStatus) {
                                return Promise.resolve(
                                    state.paused === undefined
                                        ? []
                                        : [{ paused: state.paused }],
                                );
                            }
                            if (table === indexerCursor) {
                                return Promise.resolve(
                                    state.cursor === undefined
                                        ? []
                                        : [{ block: state.cursor }],
                                );
                            }
                            return Promise.resolve([]);
                        },
                    };
                },
            };
        },
        transaction(callback: (tx: any) => Promise<void>) {
            db.txCount += 1;
            const tx = {
                insert(table: unknown) {
                    return {
                        values(_values: unknown) {
                            return {
                                onConflictDoUpdate() {
                                    if (table === indexerCursor)
                                        db.cursorWrites += 1;
                                    if (table === projectionStatus)
                                        db.statusWrites += 1;
                                    return Promise.resolve();
                                },
                            };
                        },
                    };
                },
            };
            return callback(tx);
        },
    };
    return db as any;
}

function fakePub(logsByAddress: Record<string, unknown[]>, latest = 50n) {
    const calls: Array<{
        address: string;
        fromBlock: bigint;
        toBlock: bigint;
    }> = [];
    const latestArgs: Array<{ cacheTime?: number }> = [];
    let latestCalls = 0;
    return {
        calls,
        latestArgs,
        get latestCalls() {
            return latestCalls;
        },
        async getBlockNumber(args?: { cacheTime?: number }) {
            latestCalls += 1;
            latestArgs.push(args ?? {});
            return latest;
        },
        async getLogs(args: {
            address: string;
            fromBlock: bigint;
            toBlock: bigint;
        }) {
            calls.push(args);
            return (logsByAddress[args.address] ?? []) as never;
        },
    };
}

describe("indexer helpers", () => {
    it("sorts events by block, transaction, and log across contracts", () => {
        const events: IndexerEvent[] = [
            {
                eventName: "PunchIssued",
                args: {},
                blockNumber: 5n,
                transactionIndex: 2,
                logIndex: 1,
                transactionHash:
                    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            {
                eventName: "PlanActivated",
                args: {},
                blockNumber: 4n,
                transactionIndex: 9,
                logIndex: 9,
                transactionHash:
                    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
            {
                eventName: "ConsumptionRecorded",
                args: {},
                blockNumber: 5n,
                transactionIndex: 1,
                logIndex: 2,
                transactionHash:
                    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            },
            {
                eventName: "EmissionCreditConsumed",
                args: {},
                blockNumber: 5n,
                transactionIndex: 1,
                logIndex: 1,
                transactionHash:
                    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            },
        ];

        expect(sortEvents(events).map((event) => event.eventName)).toEqual([
            "PlanActivated",
            "EmissionCreditConsumed",
            "ConsumptionRecorded",
            "PunchIssued",
        ]);
    });

    it("ignores unknown logs safely but rejects malformed known logs", async () => {
        const valid = rawLog({
            address: addresses.consumptionLog,
            abi: abis.consumptionLog,
            eventName: "ConsumptionRecorded",
            eventArgs: {
                cafeId: 1n,
                user: "0x1111111111111111111111111111111111111111",
                receiptHash:
                    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
            blockNumber: 10n,
            transactionIndex: 0,
            logIndex: 0,
            transactionHash:
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        });
        const pub = fakePub({
            [addresses.punchVault]: [],
            [addresses.planManager]: [],
            [addresses.consumptionLog]: [
                {
                    ...valid,
                    topics: [
                        "0x1234567890123456789012345678901234567890123456789012345678901234",
                    ],
                },
                valid,
            ],
        });
        const deps = {
            pub: pub as any,
            database: fakeDatabase({}),
            addresses,
        };

        const events = await fetchEvents(deps as never, 1n, 10n);
        expect(events).toHaveLength(1);
        expect(events[0]?.eventName).toBe("ConsumptionRecorded");

        const malformedPub = fakePub({
            [addresses.punchVault]: [],
            [addresses.planManager]: [],
            [addresses.consumptionLog]: [
                {
                    ...valid,
                    topics: [valid.topics[0] as Hex],
                },
            ],
        });

        await expect(
            fetchEvents(
                {
                    pub: malformedPub as any,
                    database: fakeDatabase({}),
                    addresses,
                } as never,
                1n,
                10n,
            ),
        ).rejects.toThrow();
    });
});

describe("runIndexerOnce block range", () => {
    it("caps how far a lagging pass reads", async () => {
        // Sin tope, un indexador rezagado pide un rango cada vez mayor, el RPC
        // lo rechaza y el cursor nunca vuelve a avanzar.
        const pub = fakePub(
            {
                [addresses.punchVault]: [],
                [addresses.planManager]: [],
                [addresses.consumptionLog]: [],
                [addresses.campaignEscrow]: [],
            },
            10n + MAX_BLOCKS_PER_PASS * 3n,
        );
        const database = fakeDatabase({ cursor: 10n });

        await runIndexerOnce({ pub: pub as any, database, addresses });

        for (const call of pub.calls) {
            expect(call.fromBlock).toBe(11n);
            expect(call.toBlock).toBe(10n + MAX_BLOCKS_PER_PASS);
        }
        expect(database.cursorWrites).toBe(1);
    });

    it("reads up to the head when the gap fits in one pass", async () => {
        const pub = fakePub(
            {
                [addresses.punchVault]: [],
                [addresses.planManager]: [],
                [addresses.consumptionLog]: [],
                [addresses.campaignEscrow]: [],
            },
            10n + MAX_BLOCKS_PER_PASS,
        );
        const database = fakeDatabase({ cursor: 10n });

        await runIndexerOnce({ pub: pub as any, database, addresses });

        expect(pub.calls[0]?.toBlock).toBe(10n + MAX_BLOCKS_PER_PASS);
    });
});

describe("runIndexerOnce", () => {
    it("does zero RPC and cursor writes while paused", async () => {
        const pub = fakePub({});
        const database = fakeDatabase({ paused: true, cursor: 8n });

        await runIndexerOnce({ pub: pub as any, database, addresses });

        expect(pub.latestCalls).toBe(0);
        expect(pub.calls).toHaveLength(0);
        expect(database.txCount).toBe(0);
        expect(database.cursorWrites).toBe(0);
    });

    it("uses the exact cursor range and reads latest once", async () => {
        const pub = fakePub(
            {
                [addresses.punchVault]: [],
                [addresses.planManager]: [],
                [addresses.consumptionLog]: [],
                [addresses.campaignEscrow]: [],
            },
            12n,
        );
        const database = fakeDatabase({ cursor: 10n });

        await runIndexerOnce({ pub: pub as any, database, addresses });

        expect(pub.latestCalls).toBe(1);
        expect(pub.latestArgs).toEqual([{ cacheTime: 0 }]);
        expect(pub.calls).toEqual([
            {
                address: addresses.punchVault,
                fromBlock: 11n,
                toBlock: 12n,
            },
            {
                address: addresses.consumptionLog,
                fromBlock: 11n,
                toBlock: 12n,
            },
            {
                address: addresses.planManager,
                fromBlock: 11n,
                toBlock: 12n,
            },
            {
                address: addresses.campaignEscrow,
                fromBlock: 11n,
                toBlock: 12n,
            },
        ]);
        expect(database.cursorWrites).toBe(1);
        expect(database.statusWrites).toBe(1);
    });

    it("does nothing when there are no new blocks", async () => {
        const pub = fakePub({}, 12n);
        const database = fakeDatabase({ cursor: 12n });

        await runIndexerOnce({ pub: pub as any, database, addresses });

        expect(pub.latestCalls).toBe(1);
        expect(pub.calls).toHaveLength(0);
        expect(database.txCount).toBe(0);
        expect(database.cursorWrites).toBe(0);
    });
});
