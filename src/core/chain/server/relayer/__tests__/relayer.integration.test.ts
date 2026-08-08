import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import net from "node:net";
import { eq } from "drizzle-orm";
import {
    createPublicClient,
    createWalletClient,
    hashTypedData,
    http,
    recoverTypedDataAddress,
} from "viem";
import type { LocalAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deployAll, seedCafe, waitForWrite } from "@/../scripts/dev-chain";
import { abis } from "@/core/chain/abis";
import {
    buildReceiptHash,
    proofTypedData,
    serializeProof,
} from "@/core/chain/server/proof/proof";
import { parseRevert } from "@/core/chain/server/relayer/parse-revert";
import { runRelayerOnce } from "@/core/chain/server/relayer/relayer";
import { deriveAccount } from "@/core/chain/server/wallet/derive";
import {
    findJobsToRun,
    findOrder,
    findSubmittedJobs,
    markJobConfirmed,
    markJobFailed,
    markJobPending,
    markJobRetry,
    markJobSubmitted,
    setOrderStatus,
    updateOrderAndQueue,
} from "@/core/purchase/server/repository/purchase-repository";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
const RPC_URL = "http://127.0.0.1:8555";
const MNEMONIC = "test test test test test test test test test test test junk";
const RELAYER_WALLET_INDEX = 0;
const OWNER_WALLET_INDEX = 7;
const USER_WALLET_INDEX = 11;
const AMOUNT = 8_000_000n;

type Fixture = {
    userId: string;
    cafeId: string;
    productId: string;
    orderId: string;
};

type SetupOptions = {
    chainProductId?: bigint;
    userWalletIndex?: number;
    nonce?: bigint;
    receiptTag?: string;
};

type LiveSetup = {
    addresses: Awaited<ReturnType<typeof deployAll>>;
    pub: ReturnType<typeof createPublicClient>;
    wallet: ReturnType<typeof createWalletClient>;
    relayerAccount: LocalAccount;
    ownerAccount: LocalAccount;
    userAccount: LocalAccount;
    chainProductId: bigint;
    seeded: Awaited<ReturnType<typeof seedCafe>>;
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

async function waitForPort(port: number): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        try {
            await new Promise<void>((resolve, reject) => {
                const socket = net.createConnection({
                    port,
                    host: "127.0.0.1",
                });
                socket.once("connect", () => {
                    socket.end();
                    resolve();
                });
                socket.once("error", reject);
            });
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error(`Timed out waiting for anvil on port ${port}`);
}

async function startAnvil() {
    anvil = spawn(
        "anvil",
        ["--port", "8555", "--chain-id", "31337", "--silent"],
        { stdio: "pipe" },
    );
    anvil.stderr.on("data", () => {});
    anvil.stdout.on("data", () => {});
    await waitForPort(8555);
}

async function stopAnvil() {
    if (!anvil) return;
    anvil.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 250));
    anvil = null;
}

async function cleanup() {
    for (const fixture of fixtures.splice(0)) {
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

async function cleanupChainMappedRows(
    chainCafeId: number,
    chainProductId: number,
) {
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
        findSubmittedJobs,
        markJobSubmitted,
        markJobConfirmed,
        markJobRetry,
        markJobFailed,
        markJobPending,
        setOrderStatus,
        wallet: setup.wallet,
        pub: setup.pub,
        addresses: setup.addresses,
        submitter: setup.relayerAccount.address,
        now: () => new Date(),
    };
}

async function setupQueuedOrder(
    options: SetupOptions = {},
): Promise<LiveSetup> {
    const addresses = await deployAll(RPC_URL);
    const pub = createPublicClient({
        chain: foundry,
        transport: http(RPC_URL),
    });
    const relayerAccount = deriveAccount(MNEMONIC, RELAYER_WALLET_INDEX);
    const ownerAccount = deriveAccount(MNEMONIC, OWNER_WALLET_INDEX);
    const userAccount = deriveAccount(
        MNEMONIC,
        options.userWalletIndex ?? USER_WALLET_INDEX,
    );
    const wallet = createWalletClient({
        account: relayerAccount,
        chain: foundry,
        transport: http(RPC_URL),
    });
    const chainProductId = options.chainProductId ?? 700001n;
    const seeded = await seedCafe({
        rpcUrl: RPC_URL,
        addresses,
        ownerWalletIndex: OWNER_WALLET_INDEX,
        eligibleProductIds: [chainProductId],
    });
    await cleanupChainMappedRows(
        Number(seeded.chainCafeId),
        Number(chainProductId),
    );

    const suffix = crypto.randomUUID();
    const receiptTag = options.receiptTag ?? `relayer-${suffix}`;
    const fixture: Fixture = {
        userId: `relayer-user-${suffix}`,
        cafeId: `relayer-cafe-${suffix}`,
        productId: `relayer-product-${suffix}`,
        orderId: `relayer-order-${suffix}`,
    };
    fixtures.push(fixture);

    await db.insert(user).values({
        id: fixture.userId,
        name: "Relayer User",
        email: `${suffix}@integration.invalid`,
        walletIndex: options.userWalletIndex ?? USER_WALLET_INDEX,
        walletAddress: userAccount.address,
    });
    await db.insert(cafe).values({
        id: fixture.cafeId,
        name: "Relayer Café",
        slug: `relayer-${suffix}`,
        chainCafeId: Number(seeded.chainCafeId),
        onboardingStatus: "approved",
    });
    await db.insert(cafeProduct).values({
        id: fixture.productId,
        cafeId: fixture.cafeId,
        name: "Relayer Product",
        priceSoles: "8",
        type: "emission",
        approvalStatus: "approved",
        active: true,
        chainProductId: Number(chainProductId),
    });

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

    await db.insert(purchaseOrder).values({
        id: fixture.orderId,
        cafeId: fixture.cafeId,
        userId: fixture.userId,
        productId: fixture.productId,
        amount: AMOUNT,
        yapeRef: receiptTag,
        receiptHash: proof.receiptHash,
        nonce: proof.nonce.toString(),
        expiry: new Date(Number(proof.expiry) * 1000),
        status: "user_confirmed",
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
        addresses,
        pub,
        wallet,
        relayerAccount,
        ownerAccount,
        userAccount,
        chainProductId,
        seeded,
        fixture,
        proof,
        context,
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
        args: [setup.seeded.chainCafeId],
    })) as readonly [`0x${string}`, number];
    const eligible = (await setup.pub.readContract({
        address: setup.addresses.cafeRegistry,
        abi: abis.cafeRegistry,
        functionName: "isEligible",
        args: [setup.seeded.chainCafeId, setup.chainProductId, 0],
    })) as boolean;
    const planActive = (await setup.pub.readContract({
        address: setup.addresses.planManager,
        abi: abis.planManager,
        functionName: "planActive",
        args: [setup.seeded.chainCafeId],
    })) as boolean;
    const credits = (await setup.pub.readContract({
        address: setup.addresses.planManager,
        abi: abis.planManager,
        functionName: "credits",
        args: [setup.seeded.chainCafeId],
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
        const userAccount = deriveAccount(MNEMONIC, 30 + index);
        const proof = {
            cafeId: setup.seeded.chainCafeId,
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
        args: [setup.seeded.chainCafeId],
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

        await runRelayerOnce(relayerDeps(setup));

        const diagnostic = await collectDiagnostic(setup);
        if (
            diagnostic.order?.status !== "confirmed" ||
            diagnostic.job?.status !== "confirmed" ||
            diagnostic.balance !== 1n ||
            diagnostic.credits !== 99n
        ) {
            throw new Error(JSON.stringify(diagnostic, null, 2));
        }

        expect(
            diagnostic.receipt &&
                (diagnostic.receipt as { status: string }).status,
        ).toBe("success");
        expect(diagnostic.job?.attempts).toBe(0);
        expect(diagnostic.job?.lastError).toBeNull();
        expect(diagnostic.order?.failureReason).toBeNull();
    });

    it("marks no_credits permanently on both job and order", async () => {
        const setup = await setupQueuedOrder({
            nonce: 2n,
            receiptTag: "no-credits",
        });
        await burnCredits(setup);

        await runRelayerOnce(relayerDeps(setup));

        const diagnostic = await collectDiagnostic(setup);
        if (
            diagnostic.order?.status !== "failed" ||
            diagnostic.order.failureReason !== "no_credits" ||
            diagnostic.job?.status !== "failed" ||
            diagnostic.job.lastError !== "no_credits"
        ) {
            throw new Error(JSON.stringify(diagnostic, null, 2));
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
        await runRelayerOnce(relayerDeps(setup));

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

        await runRelayerOnce(relayerDeps(setup));

        const diagnostic = await collectDiagnostic(setup);
        if (
            diagnostic.order?.status !== "confirmed" ||
            diagnostic.job?.status !== "confirmed"
        ) {
            throw new Error(JSON.stringify(diagnostic, null, 2));
        }

        expect(diagnostic.balance).toBe(1n);
        expect(diagnostic.credits).toBe(99n);
        expect(diagnostic.parsedRevert?.code).toBe("nonce_used");
    });

    it("leases one pending job to a single claimant", async () => {
        const setup = await setupQueuedOrder({
            nonce: 4n,
            receiptTag: "lease",
        });

        const [first, second] = await Promise.all([
            findJobsToRun(1, 200),
            findJobsToRun(1, 200),
        ]);

        expect(first).toHaveLength(1);
        expect(second).toHaveLength(0);
        expect(first[0]?.orderId).toBe(setup.fixture.orderId);
    });
});
