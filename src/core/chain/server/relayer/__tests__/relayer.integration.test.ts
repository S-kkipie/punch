import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import net from "node:net";
import { eq } from "drizzle-orm";
import {
    createPublicClient,
    hashTypedData,
    http,
    parseEther,
    recoverTypedDataAddress,
} from "viem";
import type { LocalAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deployAll, seedCafe, waitForWrite } from "@/../scripts/dev-chain";
import { abis } from "@/core/chain/abis";
import { createChainWalletClient } from "@/core/chain/chain";
import {
    buildReceiptHash,
    proofTypedData,
    serializeProof,
} from "@/core/chain/server/proof/proof";
import {
    markJobConfirmed as markGenericJobConfirmed,
    markJobFailed as markGenericJobFailed,
    markJobPending as markGenericJobPending,
    markJobRetry as markGenericJobRetry,
    markJobSubmitted as markGenericJobSubmitted,
} from "@/core/chain/server/relayer/job-repository";
import { parseRevert } from "@/core/chain/server/relayer/parse-revert";
import { runRelayerOnce } from "@/core/chain/server/relayer/relayer";
import { deriveAccount } from "@/core/chain/server/wallet/derive";
import {
    claimSubmittedJobs,
    findJobsToRun,
    findOrder,
    markJobFailed,
    updateOrderAndQueue,
} from "@/core/purchase/server/repository/purchase-repository";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import { consumptionProof } from "@/server/drizzle/schemas/consumption-schema";
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
};

type SetupOptions = {
    chainProductId?: bigint;
    nonce?: bigint;
    receiptTag?: string;
    relayerMnemonic?: string;
    relayerWalletIndex?: number;
    userWalletIndex?: number;
};

type LiveSetup = {
    rpcUrl: string;
    addresses: Awaited<ReturnType<typeof deployAll>>;
    pub: ReturnType<typeof createPublicClient>;
    wallet: ReturnType<typeof createChainWalletClient>;
    relayerAccount: LocalAccount;
    ownerAccount: LocalAccount;
    userAccount: LocalAccount;
    chainProductId: bigint;
    chainCafeId: bigint;
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

function pretty(value: unknown) {
    return JSON.stringify(
        value,
        (_key, item) => (typeof item === "bigint" ? item.toString() : item),
        2,
    );
}

async function runRelayerOrThrowDetails(setup: LiveSetup) {
    try {
        await runRelayerOnce(relayerDeps(setup));
    } catch (error) {
        if (error instanceof AggregateError) {
            throw new Error(
                error.errors
                    .map((item) =>
                        item instanceof Error ? item.message : String(item),
                    )
                    .join("\n"),
            );
        }
        throw error;
    }
}

type Diagnostic = {
    order: null | {
        status: string;
        failureReason: string | null;
        txHash: string | null;
    };
    job: null | {
        status: string;
        attempts: number;
        lastError: string | null;
        txHash: string | null;
    };
    receipt: unknown;
    parsedRevert: ReturnType<typeof parseRevert> | null;
    domainHash: `0x${string}`;
    liveHash: `0x${string}`;
    registryOwner: `0x${string}`;
    recoveredCafeSigner: `0x${string}`;
    recoveredUserSigner: `0x${string}`;
    proofUser: `0x${string}`;
    eligible: boolean;
    planActive: boolean;
    credits: bigint;
    balance: bigint;
    chainId: number;
    relayer: `0x${string}`;
    consumptionLog: `0x${string}`;
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
            throw new Error(`unexpected chain id ${chainId}`);
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
    let stderr = "";
    process.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
    });
    process.stdout.on("data", () => {});
    const exited = new Promise<never>((_, reject) => {
        process.once("exit", (code, signal) => {
            reject(
                new Error(
                    `anvil exited before readiness check (code=${code}, signal=${signal})${stderr ? `: ${stderr.trim()}` : ""}`,
                ),
            );
        });
    });
    await Promise.race([waitForRpcReady(rpcUrl, process), exited]);
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
    const orderIds = new Set(fixtures.map((fixture) => fixture.orderId));
    const productIds = new Set(fixtures.map((fixture) => fixture.productId));
    const cafeIds = new Set(fixtures.map((fixture) => fixture.cafeId));
    const userIds = new Set(fixtures.map((fixture) => fixture.userId));
    fixtures.splice(0);

    for (const userId of userIds) {
        await db
            .delete(consumptionProof)
            .where(eq(consumptionProof.issuedByUserId, userId));
    }
    for (const orderId of orderIds) {
        await db.delete(relayerJob).where(eq(relayerJob.orderId, orderId));
        await db.delete(purchaseOrder).where(eq(purchaseOrder.id, orderId));
    }
    for (const productId of productIds) {
        await db.delete(cafeProduct).where(eq(cafeProduct.id, productId));
    }
    for (const cafeId of cafeIds) {
        await db.delete(cafe).where(eq(cafe.id, cafeId));
    }
    for (const userId of userIds) {
        await db.delete(user).where(eq(user.id, userId));
    }
}

async function cleanupChainRows(chainCafeId: number, chainProductId: number) {
    const cafes = await db
        .select({ id: cafe.id })
        .from(cafe)
        .where(eq(cafe.chainCafeId, chainCafeId));
    for (const row of cafes) {
        const orders = await db
            .select({ id: purchaseOrder.id })
            .from(purchaseOrder)
            .where(eq(purchaseOrder.cafeId, row.id));
        for (const order of orders) {
            await db.delete(relayerJob).where(eq(relayerJob.orderId, order.id));
            await db
                .delete(purchaseOrder)
                .where(eq(purchaseOrder.id, order.id));
        }
        const products = await db
            .select({ id: cafeProduct.id })
            .from(cafeProduct)
            .where(eq(cafeProduct.cafeId, row.id));
        for (const product of products) {
            await db.delete(cafeProduct).where(eq(cafeProduct.id, product.id));
        }
        await db.delete(cafe).where(eq(cafe.id, row.id));
    }

    const strayProducts = await db
        .select({ id: cafeProduct.id })
        .from(cafeProduct)
        .where(eq(cafeProduct.chainProductId, chainProductId));
    for (const product of strayProducts) {
        await db.delete(cafeProduct).where(eq(cafeProduct.id, product.id));
    }
}

function relayerDeps(setup: LiveSetup) {
    return {
        findJobsToRun,
        claimSubmittedJobs,
        markJobSubmitted: markGenericJobSubmitted,
        markJobConfirmed: markGenericJobConfirmed,
        markJobRetry: markGenericJobRetry,
        markJobFailed: markGenericJobFailed,
        markJobPending: markGenericJobPending,
        useHandlerSideEffects: true,
        wallet: setup.wallet,
        pub: setup.pub,
        addresses: setup.addresses,
        submitter: setup.relayerAccount.address,
        now: () => new Date(),
    };
}

async function fundRelayer(
    pub: LiveSetup["pub"],
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
    userId: string;
    userEmail: string;
    userWalletIndex: number;
    userWalletAddress: `0x${string}`;
    cafeId: string;
    chainCafeId: number;
    productId: string;
    chainProductId: number;
    orderId: string;
    proof: LiveSetup["proof"];
    receiptTag: string;
    duplicateCafe?: boolean;
    duplicateProduct?: boolean;
}) {
    await db.insert(user).values({
        id: args.userId,
        name: "Relayer User",
        email: args.userEmail,
        walletIndex: args.userWalletIndex,
        walletAddress: args.userWalletAddress,
    });
    if (!args.duplicateCafe) {
        await db.insert(cafe).values({
            id: args.cafeId,
            name: "Relayer Café",
            slug: `relayer-${crypto.randomUUID()}`,
            chainCafeId: args.chainCafeId,
            onboardingStatus: "approved",
        });
    }
    if (!args.duplicateProduct) {
        await db.insert(cafeProduct).values({
            id: args.productId,
            cafeId: args.cafeId,
            name: "Relayer Product",
            priceSoles: "8",
            type: "emission",
            approvalStatus: "approved",
            active: true,
            chainProductId: args.chainProductId,
        });
    }
    await db.insert(purchaseOrder).values({
        id: args.orderId,
        cafeId: args.cafeId,
        userId: args.userId,
        productId: args.productId,
        amount: AMOUNT,
        yapeRef: args.receiptTag,
        receiptHash: args.proof.receiptHash,
        nonce: args.proof.nonce.toString(),
        expiry: new Date(Number(args.proof.expiry) * 1000),
        status: "user_confirmed",
    });
}

async function setupQueuedOrder(
    options: SetupOptions = {},
): Promise<LiveSetup> {
    const addresses = await deployAll(rpcUrl);
    const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
    const relayerAccount = deriveAccount(
        options.relayerMnemonic ?? RELAYER_MNEMONIC,
        options.relayerWalletIndex ?? RELAYER_WALLET_INDEX,
    );
    const ownerAccount = deriveAccount(ANVIL_MNEMONIC, OWNER_WALLET_INDEX);
    const userAccount = deriveAccount(
        ANVIL_MNEMONIC,
        options.userWalletIndex ?? USER_WALLET_INDEX,
    );
    const wallet = createChainWalletClient(rpcUrl, relayerAccount);
    const chainProductId = options.chainProductId ?? 700001n;
    const seeded = await seedCafe({
        rpcUrl,
        addresses,
        ownerWalletIndex: OWNER_WALLET_INDEX,
        eligibleProductIds: [chainProductId],
    });
    await cleanupChainRows(Number(seeded.chainCafeId), Number(chainProductId));
    await fundRelayer(pub, relayerAccount);

    const suffix = crypto.randomUUID();
    const receiptTag = options.receiptTag ?? `relayer-${suffix}`;
    const fixture: Fixture = {
        userId: `relayer-user-${suffix}`,
        cafeId: `relayer-cafe-${suffix}`,
        productId: `relayer-product-${suffix}`,
        orderId: `relayer-order-${suffix}`,
    };
    fixtures.push(fixture);

    const proof = {
        cafeId: seeded.chainCafeId,
        user: userAccount.address,
        productId: chainProductId,
        amount: AMOUNT,
        receiptHash: buildReceiptHash(fixture.orderId, receiptTag),
        nonce: options.nonce ?? 1n,
        expiry: BigInt(Math.floor(Date.now() / 1000) + 300),
    };
    const context = {
        chainId: foundry.id,
        verifyingContract: addresses.consumptionLog,
    } as const;

    await createFixtureRecords({
        userId: fixture.userId,
        userEmail: `${suffix}@integration.invalid`,
        userWalletIndex: options.userWalletIndex ?? USER_WALLET_INDEX,
        userWalletAddress: userAccount.address,
        cafeId: fixture.cafeId,
        chainCafeId: Number(seeded.chainCafeId),
        productId: fixture.productId,
        chainProductId: Number(chainProductId),
        orderId: fixture.orderId,
        proof,
        receiptTag,
    });

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
        chainProductId,
        chainCafeId: seeded.chainCafeId,
        fixture,
        proof,
        context,
        cafeSignature,
        userSignature,
    };
}

async function queueAdditionalOrder(
    setup: LiveSetup,
    options: { nonce: bigint; receiptTag: string; userWalletIndex: number },
): Promise<LiveSetup> {
    const userAccount = deriveAccount(ANVIL_MNEMONIC, options.userWalletIndex);
    const suffix = crypto.randomUUID();
    const fixture: Fixture = {
        userId: `relayer-user-${suffix}`,
        cafeId: setup.fixture.cafeId,
        productId: setup.fixture.productId,
        orderId: `relayer-order-${suffix}`,
    };
    fixtures.push(fixture);

    const proof = {
        cafeId: setup.chainCafeId,
        user: userAccount.address,
        productId: setup.chainProductId,
        amount: AMOUNT,
        receiptHash: buildReceiptHash(fixture.orderId, options.receiptTag),
        nonce: options.nonce,
        expiry: BigInt(Math.floor(Date.now() / 1000) + 300),
    };

    await createFixtureRecords({
        userId: fixture.userId,
        userEmail: `${suffix}@integration.invalid`,
        userWalletIndex: options.userWalletIndex,
        userWalletAddress: userAccount.address,
        cafeId: fixture.cafeId,
        chainCafeId: Number(setup.chainCafeId),
        productId: fixture.productId,
        chainProductId: Number(setup.chainProductId),
        orderId: fixture.orderId,
        proof,
        receiptTag: options.receiptTag,
        duplicateCafe: true,
        duplicateProduct: true,
    });

    const cafeSignature = await setup.ownerAccount.signTypedData(
        proofTypedData(proof, setup.context),
    );
    const userSignature = await userAccount.signTypedData(
        proofTypedData(proof, setup.context),
    );

    await updateOrderAndQueue(fixture.orderId, {
        proof: serializeProof(proof),
        cafeSignature,
        userSignature,
    });

    return {
        ...setup,
        userAccount,
        fixture,
        proof,
        cafeSignature,
        userSignature,
    };
}

async function collectDiagnostic(setup: LiveSetup): Promise<Diagnostic> {
    const [job] = await db
        .select()
        .from(relayerJob)
        .where(eq(relayerJob.orderId, setup.fixture.orderId));
    const order = await findOrder(setup.fixture.orderId);
    const receipt = job?.txHash
        ? await setup.pub.getTransactionReceipt({
              hash: job.txHash as `0x${string}`,
          })
        : null;
    let parsedRevert: ReturnType<typeof parseRevert> | null = null;
    try {
        await setup.pub.simulateContract({
            address: setup.addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [setup.proof, setup.cafeSignature, setup.userSignature],
            account: setup.relayerAccount.address,
        });
    } catch (error) {
        parsedRevert = parseRevert(error);
    }
    const liveHash = (await setup.pub.readContract({
        address: setup.addresses.consumptionLog,
        abi: abis.consumptionLog,
        functionName: "hashProof",
        args: [setup.proof],
    })) as `0x${string}`;
    const recoveredCafeSigner = await recoverTypedDataAddress({
        ...proofTypedData(setup.proof, setup.context),
        signature: setup.cafeSignature,
    });
    const recoveredUserSigner = await recoverTypedDataAddress({
        ...proofTypedData(setup.proof, setup.context),
        signature: setup.userSignature,
    });
    const liveCafe = (await setup.pub.readContract({
        address: setup.addresses.cafeRegistry,
        abi: abis.cafeRegistry,
        functionName: "getCafe",
        args: [setup.chainCafeId],
    })) as readonly [`0x${string}`, number];
    const eligible = (await setup.pub.readContract({
        address: setup.addresses.cafeRegistry,
        abi: abis.cafeRegistry,
        functionName: "isEligible",
        args: [setup.chainCafeId, setup.chainProductId, 0],
    })) as boolean;
    const planActive = (await setup.pub.readContract({
        address: setup.addresses.planManager,
        abi: abis.planManager,
        functionName: "planActive",
        args: [setup.chainCafeId],
    })) as boolean;
    const credits = (await setup.pub.readContract({
        address: setup.addresses.planManager,
        abi: abis.planManager,
        functionName: "credits",
        args: [setup.chainCafeId],
    })) as bigint;
    const balance = (await setup.pub.readContract({
        address: setup.addresses.punchVault,
        abi: abis.punchVault,
        functionName: "balanceOf",
        args: [setup.userAccount.address],
    })) as bigint;

    return {
        order: order
            ? {
                  status: order.status,
                  failureReason: order.failureReason,
                  txHash: order.txHash,
              }
            : null,
        job: job
            ? {
                  status: job.status,
                  attempts: job.attempts,
                  lastError: job.lastError,
                  txHash: job.txHash,
              }
            : null,
        receipt,
        parsedRevert,
        domainHash: hashTypedData(proofTypedData(setup.proof, setup.context)),
        liveHash,
        registryOwner: liveCafe[0],
        recoveredCafeSigner,
        recoveredUserSigner,
        proofUser: setup.proof.user,
        eligible,
        planActive,
        credits,
        balance,
        chainId: await setup.pub.getChainId(),
        relayer: setup.relayerAccount.address,
        consumptionLog: setup.addresses.consumptionLog,
    };
}

async function burnCredits(setup: LiveSetup) {
    for (let index = 0; index < 100; index++) {
        const userAccount = deriveAccount(ANVIL_MNEMONIC, 30 + index);
        const proof = {
            cafeId: setup.chainCafeId,
            user: userAccount.address,
            productId: setup.chainProductId,
            amount: AMOUNT,
            receiptHash: buildReceiptHash(
                `burn-${index}`,
                setup.fixture.orderId,
            ),
            nonce: 10_000n + BigInt(index),
            expiry: BigInt(Math.floor(Date.now() / 1000) + 300),
        };
        const cafeSignature = await setup.ownerAccount.signTypedData(
            proofTypedData(proof, setup.context),
        );
        const userSignature = await userAccount.signTypedData(
            proofTypedData(proof, setup.context),
        );
        const hash = await setup.wallet.writeContract({
            address: setup.addresses.consumptionLog,
            abi: abis.consumptionLog,
            functionName: "recordConsumption",
            args: [proof, cafeSignature, userSignature],
        } as never);
        await waitForWrite(setup.pub, hash, `burn credit ${index}`);
    }
    const credits = await setup.pub.readContract({
        address: setup.addresses.planManager,
        abi: abis.planManager,
        functionName: "credits",
        args: [setup.chainCafeId],
    });
    expect(credits).toBe(0n);
}

describeIntegration("relayer live integration", () => {
    beforeEach(async () => {
        await startAnvil();
    });

    afterEach(async () => {
        await cleanup();
        await stopAnvil();
    });

    it("hashTypedData equals live hashProof", async () => {
        const setup = await setupQueuedOrder();
        const diagnostic = await collectDiagnostic(setup);

        expect(diagnostic.liveHash).toBe(diagnostic.domainHash);
        expect(diagnostic.registryOwner).toBe(diagnostic.recoveredCafeSigner);
        expect(diagnostic.recoveredUserSigner).toBe(diagnostic.proofUser);
        expect(diagnostic.eligible).toBe(true);
        expect(diagnostic.planActive).toBe(true);
        expect(diagnostic.credits).toBe(100n);
        expect(diagnostic.chainId).toBe(foundry.id);
        expect(diagnostic.consumptionLog).toBe(setup.context.verifyingContract);
    });

    it("confirms settlement state, balance, and credits", async () => {
        const setup = await setupQueuedOrder();

        await runRelayerOrThrowDetails(setup);

        const diagnostic = await collectDiagnostic(setup);
        if (
            diagnostic.order?.status !== "confirmed" ||
            diagnostic.job?.status !== "confirmed" ||
            diagnostic.balance !== 1n ||
            diagnostic.credits !== 99n
        ) {
            throw new Error(pretty(diagnostic));
        }

        expect(
            diagnostic.receipt &&
                (diagnostic.receipt as { status: string }).status,
        ).toBe("success");
        expect(diagnostic.job?.attempts).toBe(0);
        expect(diagnostic.job?.lastError).toBeNull();
        expect(diagnostic.order?.failureReason).toBeNull();
        expect(diagnostic.relayer).toBe(setup.relayerAccount.address);
    });

    it("marks no_credits permanently on both job and order", async () => {
        const setup = await setupQueuedOrder({
            nonce: 2n,
            receiptTag: "no-credits",
        });
        await burnCredits(setup);

        await runRelayerOrThrowDetails(setup);

        const diagnostic = await collectDiagnostic(setup);
        if (
            diagnostic.order?.status !== "failed" ||
            diagnostic.order.failureReason !== "no_credits" ||
            diagnostic.job?.status !== "failed" ||
            diagnostic.job.lastError !== "no_credits"
        ) {
            throw new Error(pretty(diagnostic));
        }

        expect(diagnostic.job.attempts).toBe(0);
        expect(diagnostic.balance).toBe(0n);
        expect(diagnostic.credits).toBe(0n);
        expect(diagnostic.parsedRevert?.code).toBe("no_credits");
    }, 15000);

    it("treats NonceUsed resubmission as confirmed idempotently", async () => {
        const setup = await setupQueuedOrder({
            nonce: 3n,
            receiptTag: "nonce-used",
        });
        await runRelayerOrThrowDetails(setup);

        await db
            .update(relayerJob)
            .set({
                status: "pending",
                nextRetryAt: new Date(),
                lastError: null,
            })
            .where(eq(relayerJob.orderId, setup.fixture.orderId));
        await db
            .update(purchaseOrder)
            .set({ status: "queued", failureReason: null })
            .where(eq(purchaseOrder.id, setup.fixture.orderId));

        await runRelayerOrThrowDetails(setup);

        const diagnostic = await collectDiagnostic(setup);
        if (
            diagnostic.order?.status !== "confirmed" ||
            diagnostic.job?.status !== "confirmed"
        ) {
            throw new Error(pretty(diagnostic));
        }

        expect(diagnostic.balance).toBe(1n);
        expect(diagnostic.credits).toBe(99n);
        expect(diagnostic.parsedRevert?.code).toBe("nonce_used");
    });

    it("fails unrelated nonce collisions as nonce_conflict", async () => {
        const first = await setupQueuedOrder({
            nonce: 4n,
            receiptTag: "nonce-a",
        });
        await runRelayerOnce(relayerDeps(first));

        const second = await queueAdditionalOrder(first, {
            nonce: 4n,
            receiptTag: "nonce-b",
            userWalletIndex: USER_WALLET_INDEX + 20,
        });
        await runRelayerOnce(relayerDeps(second));

        const diagnostic = await collectDiagnostic(second);
        if (
            diagnostic.order?.status !== "failed" ||
            diagnostic.order.failureReason !== "nonce_conflict" ||
            diagnostic.job?.status !== "failed" ||
            diagnostic.job.lastError !== "nonce_conflict"
        ) {
            throw new Error(pretty(diagnostic));
        }

        expect(diagnostic.balance).toBe(0n);
        expect(diagnostic.credits).toBe(99n);
        expect(diagnostic.parsedRevert?.code).toBe("nonce_used");
    });

    it("fails the linked quote atomically with the order and leaves an unlinked quote untouched", async () => {
        const setup = await setupQueuedOrder({
            nonce: 6n,
            receiptTag: "quote-failure",
        });
        const expiry = new Date(Date.now() + 60_000);
        await db.insert(consumptionProof).values([
            {
                id: `linked-proof-${setup.fixture.orderId}`,
                cafeId: setup.fixture.cafeId,
                productId: setup.fixture.productId,
                issuedByUserId: setup.fixture.userId,
                consumerUserId: setup.fixture.userId,
                amountCentimos: 800,
                purchaseOrderId: setup.fixture.orderId,
                yapeRef: "linked-safe-ref",
                receiptHash: setup.proof.receiptHash,
                nonce: setup.proof.nonce.toString(),
                status: "submitted",
                expiresAt: expiry,
            },
            {
                id: `unlinked-proof-${setup.fixture.orderId}`,
                cafeId: setup.fixture.cafeId,
                productId: setup.fixture.productId,
                issuedByUserId: setup.fixture.userId,
                consumerUserId: setup.fixture.userId,
                amountCentimos: 800,
                purchaseOrderId: null,
                yapeRef: "unlinked-safe-ref",
                receiptHash: buildReceiptHash(
                    `unlinked-${setup.fixture.orderId}`,
                    "unlinked",
                ),
                nonce: `${setup.proof.nonce + 1n}`,
                status: "issued",
                expiresAt: expiry,
            },
        ]);
        const [job] = await db
            .select({ id: relayerJob.id })
            .from(relayerJob)
            .where(eq(relayerJob.orderId, setup.fixture.orderId));
        if (!job) throw new Error("missing relayer job");

        await markJobFailed(
            job.id,
            "safe permanent failure",
            "safe permanent failure",
        );

        const [order] = await db
            .select({
                status: purchaseOrder.status,
                failureReason: purchaseOrder.failureReason,
            })
            .from(purchaseOrder)
            .where(eq(purchaseOrder.id, setup.fixture.orderId));
        const [linked] = await db
            .select({
                status: consumptionProof.status,
                failureReason: consumptionProof.failureReason,
            })
            .from(consumptionProof)
            .where(
                eq(
                    consumptionProof.id,
                    `linked-proof-${setup.fixture.orderId}`,
                ),
            );
        const [unlinked] = await db
            .select({
                status: consumptionProof.status,
                failureReason: consumptionProof.failureReason,
            })
            .from(consumptionProof)
            .where(
                eq(
                    consumptionProof.id,
                    `unlinked-proof-${setup.fixture.orderId}`,
                ),
            );
        expect(order).toEqual({
            status: "failed",
            failureReason: "safe permanent failure",
        });
        expect(linked).toEqual({
            status: "failed",
            failureReason: "safe permanent failure",
        });
        expect(unlinked).toEqual({ status: "issued", failureReason: null });
    });

    it("leases one pending job to a single claimant", async () => {
        const setup = await setupQueuedOrder({
            nonce: 5n,
            receiptTag: "lease",
        });

        const [first, second] = await Promise.all([
            findJobsToRun(1, 200),
            findJobsToRun(1, 200),
        ]);

        expect([first.length, second.length].sort()).toEqual([0, 1]);
        expect([...first, ...second].map((job) => job.orderId)).toEqual([
            setup.fixture.orderId,
        ]);
    });
});
