import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import net from "node:net";
import { eq } from "drizzle-orm";
import {
    createPublicClient,
    http,
    parseEther,
    parseEventLogs,
    parseUnits,
} from "viem";
import type { LocalAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deployAll, seedCafe, waitForWrite } from "@/../scripts/dev-chain";
import { abis } from "@/core/chain/abis";
import { createChainWalletClient } from "@/core/chain/chain";
import { applyEvent } from "@/core/chain/server/indexer/apply-event";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import {
    buildReceiptHash,
    proofTypedData,
    serializeProof,
} from "@/core/chain/server/proof/proof";
import { runRelayerOnce } from "@/core/chain/server/relayer/relayer";
import { deriveAccount } from "@/core/chain/server/wallet/derive";
import {
    claimSubmittedJobs,
    findJobsToRun,
    findOrder,
    markJobConfirmed,
    markJobFailed,
    markJobPending,
    markJobRetry,
    markJobSubmitted,
    updateOrderAndQueue,
} from "@/core/purchase/server/repository/purchase-repository";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import {
    indexerCursor,
    projectionCafeCredit,
    projectionCampaign,
    projectionConsumption,
    projectionPunchBalance,
    projectionStatus,
} from "@/server/drizzle/schemas/chain-schema";
import {
    consumerTransaction,
    consumptionProof,
} from "@/server/drizzle/schemas/consumption-schema";
import {
    campaign,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();
const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk";
const RELAYER_MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const DEPLOYER_WALLET_INDEX = 0;
const OWNER_WALLET_INDEX = 7;
const USER_WALLET_INDEX = 11;
const RELAYER_WALLET_INDEX = 2;
const AMOUNT = 8_000_000n;

type Fixture = {
    userId: string;
    cafeId: string;
    productId: string;
    orderId: string;
    chainCafeId: number;
    chainProductId: number;
    userAddress: `0x${string}`;
    receiptHash?: `0x${string}`;
    campaignId?: string;
    campaignChainId?: number;
};

type LiveSetup = {
    rpcUrl: string;
    addresses: Awaited<ReturnType<typeof deployAll>>;
    pub: ReturnType<typeof createPublicClient>;
    wallet: ReturnType<typeof createChainWalletClient>;
    relayerAccount: LocalAccount;
    ownerAccount: LocalAccount;
    userAccount: LocalAccount;
    chainCafeId: bigint;
    chainProductId: bigint;
    fixture: Fixture;
    proof: {
        cafeId: bigint;
        user: `0x${string}`;
        productId: bigint;
        amount: bigint;
        receiptHash: `0x${string}`;
        nonce: bigint;
        expiry: bigint;
    };
    context: { chainId: number; verifyingContract: `0x${string}` };
    cafeSignature: `0x${string}`;
    userSignature: `0x${string}`;
};

const fixtures: Fixture[] = [];
let anvil: ChildProcessWithoutNullStreams | null = null;
let rpcUrl = "";

async function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close(() =>
                    reject(new Error("failed to allocate port")),
                );
                return;
            }
            server.close((error) => {
                if (error) reject(error);
                else resolve(address.port);
            });
        });
    });
}

async function waitForRpcReady(
    url: string,
    process: ChildProcessWithoutNullStreams,
) {
    const deadline = Date.now() + 15_000;
    const pub = createPublicClient({ chain: foundry, transport: http(url) });
    while (Date.now() < deadline) {
        if (process.exitCode !== null) {
            throw new Error(
                `anvil exited before becoming ready (${process.exitCode})`,
            );
        }
        try {
            const chainId = await pub.getChainId();
            if (chainId === foundry.id) return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error(`Timed out waiting for Anvil at ${url}`);
}

async function startAnvil() {
    const port = await getFreePort();
    rpcUrl = `http://127.0.0.1:${port}`;
    const process = spawn(
        "anvil",
        ["--port", String(port), "--chain-id", String(foundry.id), "--silent"],
        { stdio: "pipe" },
    );
    anvil = process;
    await waitForRpcReady(rpcUrl, process);
}

async function stopAnvil() {
    if (!anvil) return;
    const process = anvil;
    anvil = null;
    if (process.exitCode !== null) return;
    process.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 250));
}

async function cleanup() {
    await db.delete(indexerCursor).where(eq(indexerCursor.contract, "punch"));
    await db
        .delete(projectionStatus)
        .where(eq(projectionStatus.projection, "chain"));

    for (const fixture of fixtures.splice(0)) {
        if (fixture.receiptHash) {
            await db
                .delete(projectionConsumption)
                .where(
                    eq(projectionConsumption.receiptHash, fixture.receiptHash),
                );
        }
        await db
            .delete(projectionPunchBalance)
            .where(
                eq(
                    projectionPunchBalance.userAddress,
                    fixture.userAddress.toLowerCase(),
                ),
            );
        await db
            .delete(projectionCafeCredit)
            .where(eq(projectionCafeCredit.chainCafeId, fixture.chainCafeId));
        await db
            .delete(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, fixture.userId));
        if (fixture.campaignId) {
            await db
                .delete(campaign)
                .where(eq(campaign.id, fixture.campaignId));
        }
        if (fixture.campaignChainId) {
            await db
                .delete(projectionCampaign)
                .where(
                    eq(
                        projectionCampaign.chainCampaignId,
                        fixture.campaignChainId,
                    ),
                );
        }
        await db
            .delete(consumerTransaction)
            .where(eq(consumerTransaction.consumerUserId, fixture.userId));
        await db
            .delete(consumptionProof)
            .where(eq(consumptionProof.issuedByUserId, fixture.userId));
        await db
            .delete(relayerJob)
            .where(eq(relayerJob.orderId, fixture.orderId));
        await db
            .delete(purchaseOrder)
            .where(eq(purchaseOrder.id, fixture.orderId));
        await db
            .delete(cafeProduct)
            .where(eq(cafeProduct.id, fixture.productId));
        await db.delete(cafe).where(eq(cafe.id, fixture.cafeId));
        await db.delete(user).where(eq(user.id, fixture.userId));
    }
}

async function fundRelayer(
    pub: ReturnType<typeof createPublicClient>,
    relayerAccount: LocalAccount,
) {
    const deployer = deriveAccount(ANVIL_MNEMONIC, DEPLOYER_WALLET_INDEX);
    const deployerWallet = createChainWalletClient(rpcUrl, deployer);
    const hash = await deployerWallet.sendTransaction({
        account: deployer,
        to: relayerAccount.address,
        value: parseEther("1"),
    });
    await waitForWrite(pub, hash, "fund relayer");
}

async function createFixtureRecords(args: {
    fixture: Fixture;
    proof: LiveSetup["proof"];
    receiptTag: string;
}) {
    await db.insert(user).values({
        id: args.fixture.userId,
        name: "Indexer User",
        email: `${args.fixture.userId}@integration.invalid`,
        walletIndex: USER_WALLET_INDEX,
        walletAddress: args.fixture.userAddress,
    });
    await db.insert(cafe).values({
        id: args.fixture.cafeId,
        name: "Indexer Café",
        slug: `indexer-${args.fixture.orderId}`,
        chainCafeId: args.fixture.chainCafeId,
        onboardingStatus: "approved",
    });
    await db.insert(cafeProduct).values({
        id: args.fixture.productId,
        cafeId: args.fixture.cafeId,
        name: "Indexer Product",
        priceSoles: "8",
        type: "emission",
        approvalStatus: "approved",
        active: true,
        chainProductId: args.fixture.chainProductId,
    });
    await db.insert(purchaseOrder).values({
        id: args.fixture.orderId,
        cafeId: args.fixture.cafeId,
        userId: args.fixture.userId,
        productId: args.fixture.productId,
        amount: AMOUNT,
        yapeRef: args.receiptTag,
        receiptHash: args.proof.receiptHash,
        nonce: args.proof.nonce.toString(),
        expiry: new Date(Number(args.proof.expiry) * 1000),
        status: "user_confirmed",
    });
    await db.insert(consumptionProof).values({
        id: `indexer-proof-${args.fixture.orderId}`,
        cafeId: args.fixture.cafeId,
        productId: args.fixture.productId,
        issuedByUserId: args.fixture.userId,
        consumerUserId: args.fixture.userId,
        amountCentimos: 800,
        purchaseOrderId: args.fixture.orderId,
        yapeRef: args.receiptTag,
        receiptHash: args.proof.receiptHash,
        nonce: args.proof.nonce.toString(),
        status: "submitted",
        expiresAt: new Date(Number(args.proof.expiry) * 1000),
    });
}

async function setupLive(args: { nonce?: bigint; buyPack?: boolean } = {}) {
    const addresses = await deployAll(rpcUrl);
    const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
    const relayerAccount = deriveAccount(
        RELAYER_MNEMONIC,
        RELAYER_WALLET_INDEX,
    );
    const ownerAccount = deriveAccount(ANVIL_MNEMONIC, OWNER_WALLET_INDEX);
    const userAccount = deriveAccount(ANVIL_MNEMONIC, USER_WALLET_INDEX);
    const wallet = createChainWalletClient(rpcUrl, relayerAccount);
    const chainProductId = 700001n;
    const seeded = await seedCafe({
        rpcUrl,
        addresses,
        ownerWalletIndex: OWNER_WALLET_INDEX,
        eligibleProductIds: [chainProductId],
    });
    if (args.buyPack) {
        const deployer = deriveAccount(ANVIL_MNEMONIC, DEPLOYER_WALLET_INDEX);
        const deployerWallet = createChainWalletClient(rpcUrl, deployer);
        const ownerWallet = createChainWalletClient(rpcUrl, ownerAccount);
        await waitForWrite(
            pub,
            await deployerWallet.writeContract({
                address: addresses.mockPEN,
                abi: abis.mockPEN,
                functionName: "mint",
                args: [ownerAccount.address, parseUnits("40", 6)],
            } as never),
            "mint pack PEN",
        );
        await waitForWrite(
            pub,
            await ownerWallet.writeContract({
                address: addresses.mockPEN,
                abi: abis.mockPEN,
                functionName: "approve",
                args: [addresses.planManager, parseUnits("89", 6)],
            } as never),
            "approve pack PEN",
        );
        await waitForWrite(
            pub,
            await ownerWallet.writeContract({
                address: addresses.planManager,
                abi: abis.planManager,
                functionName: "buyPack",
                args: [seeded.chainCafeId],
            } as never),
            "buy pack",
        );
    }
    await fundRelayer(pub, relayerAccount);

    const suffix = crypto.randomUUID();
    const fixture: Fixture = {
        userId: `indexer-user-${suffix}`,
        cafeId: `indexer-cafe-${suffix}`,
        productId: `indexer-product-${suffix}`,
        orderId: `indexer-order-${suffix}`,
        chainCafeId: Number(seeded.chainCafeId),
        chainProductId: Number(chainProductId),
        userAddress: userAccount.address,
    };
    fixtures.push(fixture);

    const proof = {
        cafeId: seeded.chainCafeId,
        user: userAccount.address,
        productId: chainProductId,
        amount: AMOUNT,
        receiptHash: buildReceiptHash(fixture.orderId, `indexer-${suffix}`),
        nonce: args.nonce ?? 1n,
        expiry: BigInt(Math.floor(Date.now() / 1000) + 300),
    };
    fixture.receiptHash = proof.receiptHash;
    await createFixtureRecords({
        fixture,
        proof,
        receiptTag: `indexer-${suffix}`,
    });

    const context = {
        chainId: foundry.id,
        verifyingContract: addresses.consumptionLog,
    } as const;
    const cafeSignature = await ownerAccount.signTypedData(
        proofTypedData(proof, context),
    );
    const userSignature = await userAccount.signTypedData(
        proofTypedData(proof, context),
    );
    await updateOrderAndQueue(fixture.orderId, {
        proof: serializeProof(proof),
        cafeSignature,
        userSignature,
    });

    return {
        rpcUrl,
        addresses,
        pub,
        wallet,
        relayerAccount,
        ownerAccount,
        userAccount,
        chainCafeId: seeded.chainCafeId,
        chainProductId,
        fixture,
        proof,
        context,
        cafeSignature,
        userSignature,
    } satisfies LiveSetup;
}

function relayerDeps(setup: LiveSetup) {
    return {
        findJobsToRun,
        claimSubmittedJobs,
        markJobSubmitted,
        markJobConfirmed,
        markJobRetry,
        markJobFailed,
        markJobPending,
        wallet: setup.wallet,
        pub: setup.pub,
        addresses: setup.addresses,
        submitter: setup.relayerAccount.address,
        now: () => new Date(),
    };
}

async function consumptionLogs(setup: LiveSetup) {
    const logs = await setup.pub.getLogs({
        address: setup.addresses.consumptionLog,
        fromBlock: 0n,
    });
    return parseEventLogs({
        abi: abis.consumptionLog,
        logs,
        eventName: "ConsumptionRecorded",
        strict: true,
    });
}

describeIntegration("indexer live integration", () => {
    beforeEach(async () => {
        await startAnvil();
    });

    afterEach(async () => {
        await cleanup();
        await stopAnvil();
    });

    it("projects subscribe and buyPack as 100 plus 100 live", async () => {
        const setup = await setupLive({ buyPack: true });

        const logs = await setup.pub.getLogs({
            address: setup.addresses.planManager,
            fromBlock: 0n,
        });
        const planLogs = parseEventLogs({
            abi: abis.planManager,
            logs,
            strict: true,
        }).filter((log) =>
            ["PlanActivated", "PackPurchased"].includes(log.eventName),
        );
        expect(planLogs.map((log) => log.eventName)).toEqual([
            "PlanActivated",
            "PackPurchased",
        ]);

        await runIndexerOnce({
            pub: setup.pub,
            database: db,
            addresses: setup.addresses,
        });

        const [credit] = await db
            .select()
            .from(projectionCafeCredit)
            .where(
                eq(projectionCafeCredit.chainCafeId, setup.fixture.chainCafeId),
            );
        expect(credit?.credits).toBe(200n);
    });

    it("indexes one live relayer purchase, recovers order state, and stays idempotent", async () => {
        const setup = await setupLive();
        const campaignChainId = setup.fixture.chainCafeId + 100_000;
        const [campaignRow] = await db
            .insert(campaign)
            .values({
                id: `indexer-campaign-${setup.fixture.orderId}`,
                kind: "verified_acquisition",
                cafeId: setup.fixture.cafeId,
                name: "Indexer Acquisition",
                windowStart: new Date(Date.now() - 60_000),
                windowEnd: new Date(Date.now() + 60_000),
                active: true,
                chainCampaignId: campaignChainId,
            })
            .returning();
        await db.insert(projectionCampaign).values({
            chainCampaignId: campaignChainId,
            status: "published",
            budget: 100n,
            voucherPayout: 10n,
            maxVouchers: 10,
            expiry: new Date(Date.now() + 60_000),
            unlockedCount: 0,
            redeemedCount: 0,
            lastBlock: 0n,
        });
        setup.fixture.campaignId = campaignRow.id;
        setup.fixture.campaignChainId = campaignChainId;
        await runRelayerOnce(relayerDeps(setup));
        await db
            .update(purchaseOrder)
            .set({ status: "submitted", txHash: null })
            .where(eq(purchaseOrder.id, setup.fixture.orderId));

        const before = await findOrder(setup.fixture.orderId);
        expect(before?.status).toBe("submitted");

        await runIndexerOnce({
            pub: setup.pub,
            database: db,
            addresses: setup.addresses,
        });

        const [balance] = await db
            .select()
            .from(projectionPunchBalance)
            .where(
                eq(
                    projectionPunchBalance.userAddress,
                    setup.userAccount.address.toLowerCase(),
                ),
            );
        const [credit] = await db
            .select()
            .from(projectionCafeCredit)
            .where(
                eq(projectionCafeCredit.chainCafeId, setup.fixture.chainCafeId),
            );
        const consumptions = await db
            .select()
            .from(projectionConsumption)
            .where(
                eq(projectionConsumption.receiptHash, setup.proof.receiptHash),
            );
        const [cursor] = await db
            .select()
            .from(indexerCursor)
            .where(eq(indexerCursor.contract, "punch"));
        const order = await findOrder(setup.fixture.orderId);
        const [quote] = await db
            .select()
            .from(consumptionProof)
            .where(eq(consumptionProof.purchaseOrderId, setup.fixture.orderId));
        const [history] = await db
            .select()
            .from(consumerTransaction)
            .where(
                eq(consumerTransaction.purchaseOrderId, setup.fixture.orderId),
            );
        const vouchers = await db
            .select()
            .from(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, setup.fixture.userId));
        const unlockJobs = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.kind, "voucher_unlock"));
        const liveConsumption = (await consumptionLogs(setup))[0];

        expect(balance?.balance).toBe(1n);
        expect(credit?.credits).toBe(99n);
        expect(consumptions).toHaveLength(1);
        expect(cursor?.lastProcessedBlock).toBe(
            await setup.pub.getBlockNumber(),
        );
        expect(order?.status).toBe("confirmed");
        expect(quote?.status).toBe("confirmed");
        expect(vouchers).toHaveLength(0);
        expect(unlockJobs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "voucher_unlock",
                    status: "pending",
                }),
            ]),
        );
        expect(history).toMatchObject({
            operation: "emission",
            status: "confirmed",
            purchaseOrderId: setup.fixture.orderId,
            transactionHash: liveConsumption?.transactionHash,
            logIndex: liveConsumption?.logIndex,
        });
        expect(consumptions[0]).toMatchObject({
            txHash: liveConsumption?.transactionHash,
            logIndex: liveConsumption?.logIndex,
            block: liveConsumption?.blockNumber,
        });

        const snapshot = JSON.stringify(
            {
                balance,
                credit,
                consumptions,
                cursor,
                order,
            },
            (_key, value) =>
                typeof value === "bigint" ? value.toString() : value,
        );
        await runIndexerOnce({
            pub: setup.pub,
            database: db,
            addresses: setup.addresses,
        });
        const [balanceAfter] = await db
            .select()
            .from(projectionPunchBalance)
            .where(
                eq(
                    projectionPunchBalance.userAddress,
                    setup.userAccount.address.toLowerCase(),
                ),
            );
        const [creditAfter] = await db
            .select()
            .from(projectionCafeCredit)
            .where(
                eq(projectionCafeCredit.chainCafeId, setup.fixture.chainCafeId),
            );
        const consumptionsAfter = await db
            .select()
            .from(projectionConsumption)
            .where(
                eq(projectionConsumption.receiptHash, setup.proof.receiptHash),
            );
        const [cursorAfter] = await db
            .select()
            .from(indexerCursor)
            .where(eq(indexerCursor.contract, "punch"));
        const snapshotAfter = JSON.stringify(
            {
                balance: balanceAfter,
                credit: creditAfter,
                consumptions: consumptionsAfter,
                cursor: cursorAfter,
                order: await findOrder(setup.fixture.orderId),
            },
            (_key, value) =>
                typeof value === "bigint" ? value.toString() : value,
        );
        expect(snapshotAfter).toBe(snapshot);
    });

    it("pauses without RPC, cursor, or projection movement", async () => {
        const setup = await setupLive();
        await db.insert(projectionStatus).values({
            projection: "chain",
            paused: true,
            lastGoodBlock: 7n,
        });
        const calls = { latest: 0, logs: 0 };

        await runIndexerOnce({
            pub: {
                async getBlockNumber() {
                    calls.latest += 1;
                    return setup.pub.getBlockNumber();
                },
                async getLogs(args: Parameters<typeof setup.pub.getLogs>[0]) {
                    calls.logs += 1;
                    return setup.pub.getLogs(args);
                },
            } as never,
            database: db,
            addresses: setup.addresses,
        });

        expect(calls).toEqual({ latest: 0, logs: 0 });
        const cursorRows = await db
            .select()
            .from(indexerCursor)
            .where(eq(indexerCursor.contract, "punch"));
        const creditRows = await db
            .select()
            .from(projectionCafeCredit)
            .where(
                eq(projectionCafeCredit.chainCafeId, setup.fixture.chainCafeId),
            );
        expect(cursorRows).toHaveLength(0);
        expect(creditRows).toHaveLength(0);
    });

    it("rolls back projections and cursor atomically when apply fails", async () => {
        const setup = await setupLive();
        await runRelayerOnce(relayerDeps(setup));
        const beforeCursor = await db
            .select()
            .from(indexerCursor)
            .where(eq(indexerCursor.contract, "punch"));
        const beforeBalance = await db
            .select()
            .from(projectionPunchBalance)
            .where(
                eq(
                    projectionPunchBalance.userAddress,
                    setup.userAccount.address.toLowerCase(),
                ),
            );
        const beforeCredit = await db
            .select()
            .from(projectionCafeCredit)
            .where(
                eq(projectionCafeCredit.chainCafeId, setup.fixture.chainCafeId),
            );
        const beforeConsumptions = await db
            .select()
            .from(projectionConsumption)
            .where(
                eq(projectionConsumption.receiptHash, setup.proof.receiptHash),
            );
        let seen = 0;

        await expect(
            runIndexerOnce({
                pub: setup.pub,
                database: db,
                addresses: setup.addresses,
                apply: async (tx, event) => {
                    seen += 1;
                    if (seen === 2) throw new Error("boom");
                    await applyEvent(tx, event);
                },
            }),
        ).rejects.toThrow("boom");

        const [balance] = await db
            .select()
            .from(projectionPunchBalance)
            .where(
                eq(
                    projectionPunchBalance.userAddress,
                    setup.userAccount.address.toLowerCase(),
                ),
            );
        const [credit] = await db
            .select()
            .from(projectionCafeCredit)
            .where(
                eq(projectionCafeCredit.chainCafeId, setup.fixture.chainCafeId),
            );
        const consumptions = await db
            .select()
            .from(projectionConsumption)
            .where(
                eq(projectionConsumption.receiptHash, setup.proof.receiptHash),
            );
        const cursorRows = await db
            .select()
            .from(indexerCursor)
            .where(eq(indexerCursor.contract, "punch"));

        expect(balance ? [balance] : []).toEqual(beforeBalance);
        expect(credit ? [credit] : []).toEqual(beforeCredit);
        expect(consumptions).toEqual(beforeConsumptions);
        expect(cursorRows).toEqual(beforeCursor);
    });
});
