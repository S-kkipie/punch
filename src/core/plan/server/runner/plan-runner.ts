import "server-only";

import type { Address, Hex } from "viem";
import type { HDAccount } from "viem/accounts";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import {
    createChainPublicClient,
    createChainWalletClient,
} from "@/core/chain/chain";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import {
    backoffMs,
    classifyPlanError,
    MAX_PLAN_ATTEMPTS,
} from "@/core/plan/domain/errors";
import type { PlanOrderKind } from "@/core/plan/domain/types";
import type { PlanOrderRow } from "@/server/drizzle/schemas/plan-schema";
import {
    claimSubmittedOrders,
    extendSubmittedLease,
    findOrdersToRun,
    markOrderConfirmed,
    markOrderExecuting,
    markOrderFailed,
    markOrderRetry,
    markOrderSubmitted,
    PLAN_CLAIM_LEASE_MS,
} from "../repository/plan-repository";
import { ensureGas, ensureMpen } from "./funding";

export const PLAN_BATCH_SIZE = 5;
const RECEIPT_WAIT_MS = 15_000;

export type PlanRunnerDeps = {
    findOrdersToRun: typeof findOrdersToRun;
    claimSubmittedOrders: typeof claimSubmittedOrders;
    extendSubmittedLease: typeof extendSubmittedLease;
    markOrderExecuting: typeof markOrderExecuting;
    markOrderSubmitted: typeof markOrderSubmitted;
    markOrderConfirmed: typeof markOrderConfirmed;
    markOrderRetry: typeof markOrderRetry;
    markOrderFailed: typeof markOrderFailed;
    deriveAccount: (walletIndex: number) => HDAccount;
    ensureGas: (signer: Address) => Promise<void>;
    ensureMpen: (input: { account: HDAccount; price: bigint }) => Promise<void>;
    readAllowance: (owner: Address) => Promise<bigint>;
    approve: (account: HDAccount, amount: bigint) => Promise<void>;
    simulate: (
        account: HDAccount,
        kind: PlanOrderKind,
        chainCafeId: number,
    ) => Promise<void>;
    send: (
        account: HDAccount,
        kind: PlanOrderKind,
        chainCafeId: number,
    ) => Promise<Hex>;
    waitForReceipt: (hash: Hex) => Promise<{ status: string }>;
    now: () => Date;
};

const defaults: PlanRunnerDeps = {
    findOrdersToRun,
    claimSubmittedOrders,
    extendSubmittedLease,
    markOrderExecuting,
    markOrderSubmitted,
    markOrderConfirmed,
    markOrderRetry,
    markOrderFailed,
    deriveAccount: deriveUserAccount,
    ensureGas: (signer) => ensureGas(signer),
    ensureMpen: (input) => ensureMpen(input),
    readAllowance: async (owner) =>
        createChainPublicClient().readContract({
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "allowance",
            args: [owner, getAddresses().planManager],
        }) as Promise<bigint>,
    approve: async (account, amount) => {
        const wallet = createChainWalletClient(undefined, account);
        const hash = await wallet.writeContract({
            account,
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "approve",
            args: [getAddresses().planManager, amount],
        });
        await createChainPublicClient().waitForTransactionReceipt({ hash });
    },
    simulate: async (account, kind, chainCafeId) => {
        const pub = createChainPublicClient();
        const address = getAddresses().planManager;
        const functionName = kind === "plan" ? "subscribe" : "buyPack";
        // Simulating first turns almost every revert into a clean failure
        // before any gas is spent.
        await pub.simulateContract({
            address,
            abi: abis.planManager,
            functionName,
            args: [BigInt(chainCafeId)],
            account: account.address,
        });
    },
    send: async (account, kind, chainCafeId) => {
        const wallet = createChainWalletClient(undefined, account);
        const address = getAddresses().planManager;
        const functionName = kind === "plan" ? "subscribe" : "buyPack";
        return wallet.writeContract({
            account,
            address,
            abi: abis.planManager,
            functionName,
            args: [BigInt(chainCafeId)],
        });
    },
    waitForReceipt: async (hash) =>
        createChainPublicClient().waitForTransactionReceipt({
            hash,
            timeout: RECEIPT_WAIT_MS,
        }),
    now: () => new Date(),
};

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function handleFailure(
    d: PlanRunnerDeps,
    order: PlanOrderRow,
    error: unknown,
): Promise<void> {
    const text = errorText(error);
    const { permanent, reason } = classifyPlanError(error);
    if (permanent && reason) {
        await d.markOrderFailed(order.id, text, reason);
        return;
    }
    const attempts = order.attempts + 1;
    if (attempts >= MAX_PLAN_ATTEMPTS) {
        await d.markOrderFailed(order.id, text, "max_attempts");
        return;
    }
    const nextRetryAt = new Date(d.now().getTime() + backoffMs(order.attempts));
    await d.markOrderRetry(order.id, text, attempts, nextRetryAt);
}

async function runPending(
    d: PlanRunnerDeps,
    order: PlanOrderRow,
): Promise<void> {
    let account: HDAccount;
    try {
        account = d.deriveAccount(order.signerWalletIndex);
        await d.ensureGas(account.address);
        await d.ensureMpen({ account, price: order.price });
        const allowance = await d.readAllowance(account.address);
        if (allowance < order.price) await d.approve(account, order.price);
        await d.simulate(account, order.kind, order.chainCafeId);
        const executing = await d.markOrderExecuting(
            order.id,
            new Date(d.now().getTime() + PLAN_CLAIM_LEASE_MS),
        );
        if (!executing) return;
    } catch (error) {
        await handleFailure(d, order, error);
        return;
    }

    try {
        const hash = await d.send(account, order.kind, order.chainCafeId);
        const submitted = await d.markOrderSubmitted(
            order.id,
            hash,
            new Date(d.now().getTime() + 2_000),
        );
        if (!submitted) {
            await d.markOrderFailed(
                order.id,
                `transaction submission could not be recorded (tx ${hash})`,
                "needs_reconciliation",
            );
        }
    } catch (error) {
        await d.markOrderFailed(
            order.id,
            errorText(error),
            "needs_reconciliation",
        );
    }
}

async function runSubmitted(
    d: PlanRunnerDeps,
    order: PlanOrderRow,
): Promise<void> {
    if (!order.txHash) {
        await d.markOrderFailed(
            order.id,
            "submitted without a recorded transaction hash",
            "needs_reconciliation",
        );
        return;
    }
    try {
        const receipt = await d.waitForReceipt(order.txHash as Hex);
        if (receipt.status === "success") {
            await d.markOrderConfirmed(order.id);
            return;
        }
        await d.markOrderFailed(order.id, "transaction reverted", "reverted");
    } catch {
        // No receipt yet. Keep it in the submitted lane — an order that was
        // already sent must never return to pending, or the next tick pays again.
        await d.extendSubmittedLease(
            order.id,
            new Date(d.now().getTime() + 2_000),
        );
    }
}

export async function runPlanRunnerOnce(
    overrides: Partial<PlanRunnerDeps> = {},
): Promise<void> {
    const d = { ...defaults, ...overrides };
    const pending = await d.findOrdersToRun(PLAN_BATCH_SIZE);
    for (const order of pending) await runPending(d, order);
    const submitted = await d.claimSubmittedOrders(PLAN_BATCH_SIZE);
    for (const order of submitted) await runSubmitted(d, order);
}

export async function recoverStuckPlanOrders(
    overrides: Partial<PlanRunnerDeps> = {},
): Promise<void> {
    const d = { ...defaults, ...overrides };
    const stuck = await d.claimSubmittedOrders(PLAN_BATCH_SIZE);
    for (const order of stuck) await runSubmitted(d, order);
}
