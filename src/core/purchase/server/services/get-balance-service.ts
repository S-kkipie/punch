import "server-only";

import { eq } from "drizzle-orm";
import { type ConsumerChainMode, ServerConfig } from "@/config/server-config";
import { isChainProjectionStale } from "@/core/chain/server/reconciler/reconciler";
import { getBalance as getMockBalance } from "@/core/punch/server/repository/balance";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { projectionPunchBalance } from "@/server/drizzle/schemas/chain-schema";
import { purchaseRepository } from "../repository/purchase-repository";

export type BalanceResponse = {
    punchBalance: number | null;
    stale: boolean;
};

export type ConsumerBalanceDeps = {
    consumerChainMode: ConsumerChainMode;
    mockBalance: (userId: string) => Promise<number>;
};

export async function getConsumerBalance(
    userId: string,
    overrides: Partial<ConsumerBalanceDeps> = {},
): Promise<AsyncAppResult<BalanceResponse>> {
    const consumerChainMode =
        overrides.consumerChainMode ?? ServerConfig.consumerChainMode;
    if (consumerChainMode === "mock") {
        try {
            const punchBalance = await (
                overrides.mockBalance ?? getMockBalance
            )(userId);
            return ok({ punchBalance, stale: false });
        } catch (cause) {
            return err(AppErrors.unexpected(cause));
        }
    }
    return getChainBackedBalance(userId);
}

export type BalanceDeps = {
    findUserWallet: typeof purchaseRepository.findUserWallet;
    findBalance: (walletAddress: string) => Promise<{ balance: bigint } | null>;
    isStale: typeof isChainProjectionStale;
};

const findBalance: BalanceDeps["findBalance"] = async (walletAddress) => {
    const [row] = await db
        .select({ balance: projectionPunchBalance.balance })
        .from(projectionPunchBalance)
        .where(eq(projectionPunchBalance.userAddress, walletAddress))
        .limit(1);
    return row ?? null;
};

const defaults: BalanceDeps = {
    findUserWallet: purchaseRepository.findUserWallet,
    findBalance,
    isStale: isChainProjectionStale,
};

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export async function getChainBackedBalance(
    userId: string,
    deps: Partial<BalanceDeps> = {},
): Promise<AsyncAppResult<ChainBackedBalance>> {
    return getBalanceService(userId, deps);
}

export type ChainBackedBalance = BalanceResponse;

export async function getBalanceService(
    userId: string,
    deps: Partial<BalanceDeps> = {},
): Promise<AsyncAppResult<BalanceResponse>> {
    try {
        const d = { ...defaults, ...deps };
        const [wallet, stale] = await Promise.all([
            d.findUserWallet(userId),
            d.isStale(),
        ]);

        if (!wallet?.walletAddress)
            return ok({ punchBalance: stale ? null : 0, stale });

        const projection = await d.findBalance(
            wallet.walletAddress.toLowerCase(),
        );
        if (!projection) return ok({ punchBalance: stale ? null : 0, stale });

        if (projection.balance < 0n || projection.balance > MAX_SAFE_BIGINT) {
            return err(
                AppErrors.unexpected(new Error("invalid punch balance")),
            );
        }

        const punchBalance = Number(projection.balance);
        if (!Number.isSafeInteger(punchBalance)) {
            return err(
                AppErrors.unexpected(new Error("invalid punch balance")),
            );
        }

        return ok({ punchBalance, stale });
    } catch {
        return err(AppErrors.unexpected(new Error("balance lookup failed")));
    }
}
