import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import net from "node:net";
import {
    createPublicClient,
    encodeAbiParameters,
    encodeEventTopics,
    getAbiItem,
    type Hex,
    http,
    parseEther,
} from "viem";
import { foundry } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deployAll, seedCafe, waitForWrite } from "@/../scripts/dev-chain";
import { abis } from "@/core/chain/abis";
import localAddresses from "@/core/chain/addresses.local.json";
import { createChainWalletClient } from "@/core/chain/chain";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import {
    buildReceiptHash,
    proofTypedData,
} from "@/core/chain/server/proof/proof";
import { deriveAccount } from "@/core/chain/server/wallet/derive";
import { db } from "@/server/drizzle/db";
import {
    indexerCursor,
    projectionCafeCredit,
    projectionConsumption,
    projectionPunchBalance,
    projectionStatus,
} from "@/server/drizzle/schemas/chain-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import { isChainProjectionStale, runReconcilerOnce } from "../reconciler";

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

function databaseState(overrides?: {
    credits?: Array<{
        chainCafeId: number;
        credits: bigint;
        lastBlock: bigint;
    }>;
}) {
    const state = {
        cursor: 12n,
        balances: [{ userAddress: "0x1", balance: 2n, lastBlock: 12n }],
        credits: overrides?.credits ?? [
            { chainCafeId: 1, credits: 99n, lastBlock: 12n },
        ],
        consumption: [{ id: "one" }],
        paused: false,
        lastGoodBlock: 12n,
    };
    const rowsFor = (table: unknown) => {
        if (table === indexerCursor)
            return state.cursor === undefined ? [] : [{ block: state.cursor }];
        if (table === projectionPunchBalance) return state.balances;
        if (table === projectionCafeCredit) return state.credits;
        if (table === projectionConsumption) return state.consumption;
        if (table === projectionStatus) return [{ paused: state.paused }];
        return [];
    };
    const transaction = async (callback: (tx: never) => Promise<void>) => {
        await callback(db as never);
    };
    const db = {
        select() {
            return {
                from(table: unknown) {
                    const query = Promise.resolve(rowsFor(table));
                    return Object.assign(query, {
                        where: async () => rowsFor(table),
                    });
                },
            };
        },
        insert(table: unknown) {
            return {
                values(values: Record<string, unknown>) {
                    return {
                        async onConflictDoUpdate({
                            set,
                        }: {
                            set: Record<string, unknown>;
                        }) {
                            if (table === projectionStatus) {
                                state.paused = Boolean(
                                    set.paused ?? values.paused,
                                );
                                if (set.lastGoodBlock !== undefined)
                                    state.lastGoodBlock =
                                        set.lastGoodBlock as bigint;
                            }
                        },
                    };
                },
            };
        },
        delete(table: unknown) {
            const action = async () => {
                if (table === projectionPunchBalance) state.balances = [];
                if (table === projectionCafeCredit) state.credits = [];
                if (table === projectionConsumption) state.consumption = [];
            };
            return action();
        },
        transaction,
    };
    return { state, db: db as never };
}

function chain(args: {
    consumptionCount: number;
    chainCredits?: Record<number, bigint>;
}) {
    const latestArgs: Array<{ cacheTime?: number }> = [];
    const chainCredits = args.chainCredits ?? { 1: 99n };
    const planLogs = Object.keys(chainCredits).map((key, index) =>
        rawLog({
            address: addresses.planManager,
            abi: abis.planManager,
            eventName: "PlanActivated",
            eventArgs: { cafeId: BigInt(key) },
            blockNumber: 9n + BigInt(index),
            transactionIndex: index,
            logIndex: index,
            transactionHash: `0x${`${index + 1}`.padStart(64, "0")}` as Hex,
        }),
    );
    const consumptionLogs = Array.from(
        { length: args.consumptionCount },
        (_, index) =>
            rawLog({
                address: addresses.consumptionLog,
                abi: abis.consumptionLog,
                eventName: "ConsumptionRecorded",
                eventArgs: {
                    cafeId: 1n,
                    user: "0x1111111111111111111111111111111111111111",
                    receiptHash: `0x${(index + 20).toString(16).padStart(64, "0")}`,
                },
                blockNumber: 10n + BigInt(index),
                transactionIndex: index,
                logIndex: index,
                transactionHash:
                    `0x${`${index + 20}`.padStart(64, "0")}` as Hex,
            }),
    );
    return {
        latestArgs,
        async getBlockNumber(args?: { cacheTime?: number }) {
            latestArgs.push(args ?? {});
            return 12n;
        },
        async getLogs(request: { address: string }) {
            if (request.address === addresses.planManager) return planLogs;
            if (request.address === addresses.consumptionLog)
                return consumptionLogs;
            return [];
        },
        async readContract(request: { functionName: string; args?: bigint[] }) {
            if (request.functionName === "totalLivePunch") return 2n;
            const cafeId = Number(request.args?.[0] ?? 1n);
            return chainCredits[cafeId] ?? 0n;
        },
    };
}

describe("runReconcilerOnce", () => {
    it("reports clean projections and repairs corruption while staying stale during reindex", async () => {
        const { state, db } = databaseState();
        const pub = chain({ consumptionCount: 1 });
        const result = await runReconcilerOnce({
            pub: pub as never,
            database: db,
            addresses,
        });
        expect(result).toEqual({ diverged: false, repaired: false });
        expect(pub.latestArgs).toEqual([{ cacheTime: 0 }]);
        expect(await isChainProjectionStale(db)).toBe(false);

        const balance = state.balances[0];
        if (!balance) throw new Error("missing test balance");
        balance.balance = 7n;
        let forceSeen = false;
        const repaired = await runReconcilerOnce({
            pub: pub as never,
            database: db,
            addresses,
            runIndexer: async (deps) => {
                forceSeen = deps?.force === true;
                state.balances = [
                    { userAddress: "0x1", balance: 2n, lastBlock: 12n },
                ];
                state.credits = [
                    { chainCafeId: 1, credits: 99n, lastBlock: 12n },
                ];
                state.consumption = [{ id: "one" }];
            },
        });
        expect(repaired).toEqual({ diverged: true, repaired: true });
        expect(forceSeen).toBe(true);
        expect(await isChainProjectionStale(db)).toBe(false);
    });

    it("detects consumption events that were missed by the indexer", async () => {
        const { state, db } = databaseState();
        const pub = chain({ consumptionCount: 3 });
        const result = await runReconcilerOnce({
            pub: pub as never,
            database: db,
            addresses,
            runIndexer: async () => {
                state.balances = [
                    { userAddress: "0x1", balance: 2n, lastBlock: 12n },
                ];
                state.credits = [
                    { chainCafeId: 1, credits: 99n, lastBlock: 12n },
                ];
                state.consumption = [
                    { id: "one" },
                    { id: "two" },
                    { id: "three" },
                ];
            },
        });
        expect(result).toEqual({ diverged: true, repaired: true });
        expect(state.consumption).toHaveLength(3);
    });

    it("detects chain-only cafe credits that are missing from projection", async () => {
        const { state, db } = databaseState({ credits: [] });
        const pub = chain({ consumptionCount: 1, chainCredits: { 2: 100n } });

        const result = await runReconcilerOnce({
            pub: pub as never,
            database: db,
            addresses,
            runIndexer: async () => {
                state.balances = [
                    { userAddress: "0x1", balance: 2n, lastBlock: 12n },
                ];
                state.credits = [
                    { chainCafeId: 2, credits: 100n, lastBlock: 12n },
                ];
                state.consumption = [{ id: "one" }];
            },
        });

        expect(result).toEqual({ diverged: true, repaired: true });
        expect(state.credits).toEqual([
            { chainCafeId: 2, credits: 100n, lastBlock: 12n },
        ]);
    });

    it("keeps projections stale when repair remains divergent", async () => {
        const { db } = databaseState();
        const result = await runReconcilerOnce({
            pub: chain({ consumptionCount: 2 }) as never,
            database: db,
            addresses,
            runIndexer: async () => undefined,
        });
        expect(result).toEqual({ diverged: true, repaired: false });
        expect(await isChainProjectionStale(db)).toBe(true);
    });
});

const runLive = process.env.PUNCH_RUN_INTEGRATION === "1";
installIntegrationDbMutex();
const mnemonic = "test test test test test test test test test test test junk";
let anvil: ChildProcessWithoutNullStreams | undefined;
let rpcUrl = "";
let previousRpc: string | undefined;
let previousEnv: string | undefined;
let previousAddresses = "";

async function freePort() {
    return await new Promise<number>((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string")
                return reject(new Error("port allocation failed"));
            server.close((error) =>
                error ? reject(error) : resolve(address.port),
            );
        });
    });
}

async function startLive() {
    const port = await freePort();
    rpcUrl = `http://127.0.0.1:${port}`;
    anvil = spawn(
        "anvil",
        ["--port", String(port), "--chain-id", String(foundry.id), "--silent"],
        { stdio: "pipe" },
    );
    const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (anvil.exitCode !== null)
            throw new Error("Anvil exited before startup");
        try {
            if ((await pub.getChainId()) === foundry.id) return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error("Anvil startup timeout");
}

async function stopLive() {
    if (anvil && anvil.exitCode === null) anvil.kill("SIGTERM");
    anvil = undefined;
}

const liveDescribe = describe.skipIf(!runLive);
liveDescribe("reconciler live integration", () => {
    let liveAddresses: Awaited<ReturnType<typeof deployAll>>;
    let pub: ReturnType<typeof createPublicClient>;
    let owner: ReturnType<typeof deriveAccount>;
    let cafeId: bigint;
    const productId = 700001n;

    beforeEach(async () => {
        previousAddresses = JSON.stringify(localAddresses);
        previousRpc = process.env.CHAIN_RPC_URL;
        previousEnv = process.env.CHAIN_ENV;
        await startLive();
        liveAddresses = await deployAll(rpcUrl);
        Object.assign(localAddresses, liveAddresses);
        process.env.CHAIN_RPC_URL = rpcUrl;
        process.env.CHAIN_ENV = "local";
        pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
        owner = deriveAccount(mnemonic, 7);
        const funder = createChainWalletClient(
            rpcUrl,
            deriveAccount(mnemonic, 0),
        );
        for (const index of [11, 12, 13]) {
            const account = deriveAccount(mnemonic, index);
            await waitForWrite(
                pub,
                await funder.sendTransaction({
                    account: deriveAccount(mnemonic, 0),
                    to: account.address,
                    value: parseEther("1"),
                }),
                `fund purchase account ${index}`,
            );
        }
        const adminWallet = createChainWalletClient(
            rpcUrl,
            deriveAccount(mnemonic, 0),
        );
        await waitForWrite(
            pub,
            await adminWallet.writeContract({
                address: liveAddresses.consumptionLog,
                abi: abis.consumptionLog,
                functionName: "setMaxDailyPerUserCafe",
                args: [100n],
            } as never),
            "raise live purchase limit",
        );
        const seeded = await seedCafe({
            rpcUrl,
            addresses: liveAddresses,
            ownerWalletIndex: 7,
            eligibleProductIds: [productId],
        });
        cafeId = seeded.chainCafeId;
        await db.delete(projectionPunchBalance);
        await db.delete(projectionCafeCredit);
        await db.delete(projectionConsumption);
        await db.delete(indexerCursor);
        await db.delete(projectionStatus);
    });

    afterEach(async () => {
        await db.delete(projectionPunchBalance);
        await db.delete(projectionCafeCredit);
        await db.delete(projectionConsumption);
        await db.delete(indexerCursor);
        await db.delete(projectionStatus);
        Object.assign(localAddresses, JSON.parse(previousAddresses));
        process.env.CHAIN_RPC_URL = previousRpc;
        process.env.CHAIN_ENV = previousEnv;
        await stopLive();
    });

    async function purchase(nonce: bigint) {
        const purchaseUser = deriveAccount(mnemonic, 10 + Number(nonce));
        const proof = {
            cafeId,
            user: purchaseUser.address,
            productId,
            amount: 8_000_000n,
            receiptHash: buildReceiptHash(
                `reconciler-${nonce}`,
                `live-${nonce}`,
            ),
            nonce,
            expiry: BigInt(Math.floor(Date.now() / 1000) + 300),
        } as const;
        const context = {
            chainId: foundry.id,
            verifyingContract: liveAddresses.consumptionLog,
        } as const;
        const cafeSignature = await owner.signTypedData(
            proofTypedData(proof, context),
        );
        const userSignature = await purchaseUser.signTypedData(
            proofTypedData(proof, context),
        );
        const wallet = createChainWalletClient(rpcUrl, purchaseUser);
        await waitForWrite(
            pub,
            await wallet.writeContract({
                address: liveAddresses.consumptionLog,
                abi: abis.consumptionLog,
                functionName: "recordConsumption",
                args: [proof, cafeSignature, userSignature],
            } as never),
            `live purchase ${nonce}`,
        );
    }

    it("repairs corruption and missed live purchases", async () => {
        await purchase(1n);
        await runIndexerOnce({ pub, database: db, addresses: liveAddresses });
        const clean = await runReconcilerOnce({
            pub,
            database: db,
            addresses: liveAddresses,
        });
        expect(clean).toEqual({ diverged: false, repaired: false });
        await db.update(projectionPunchBalance).set({ balance: 99n });
        expect(
            await runReconcilerOnce({
                pub,
                database: db,
                addresses: liveAddresses,
            }),
        ).toEqual({ diverged: true, repaired: true });
        expect(await db.select().from(projectionConsumption)).toHaveLength(1);
        await purchase(2n);
        await purchase(3n);
        const missed = await runReconcilerOnce({
            pub,
            database: db,
            addresses: liveAddresses,
        });
        expect(missed).toEqual({ diverged: true, repaired: true });
        expect(await db.select().from(projectionConsumption)).toHaveLength(3);
        expect(await isChainProjectionStale()).toBe(false);
    });

    it("repairs chain-only cafe credits added after the indexer cursor", async () => {
        await purchase(1n);
        await runIndexerOnce({ pub, database: db, addresses: liveAddresses });
        const secondCafe = await seedCafe({
            rpcUrl,
            addresses: liveAddresses,
            ownerWalletIndex: 8,
            eligibleProductIds: [700002n],
        });

        const result = await runReconcilerOnce({
            pub,
            database: db,
            addresses: liveAddresses,
        });

        expect(result).toEqual({ diverged: true, repaired: true });
        const credits = await db.select().from(projectionCafeCredit);
        expect(credits).toHaveLength(2);
        expect(credits).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    chainCafeId: Number(cafeId),
                    credits: 99n,
                }),
                expect.objectContaining({
                    chainCafeId: Number(secondCafe.chainCafeId),
                    credits: 100n,
                }),
            ]),
        );
        expect(await isChainProjectionStale()).toBe(false);
    });
});
