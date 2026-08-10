import "server-only";

import { and, eq } from "drizzle-orm";
import type { Address } from "viem";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafeMember } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCafePayout } from "@/server/drizzle/schemas/chain-schema";

export type CafePayouts = {
    totalCentimos: number;
    redemptionCount: number;
    ownerMpenCentimos: number | null;
};

type CafePayoutDeps = {
    requireMember: typeof requireCafeRole;
    findProjection: (cafeId: string) => Promise<{
        totalCentimos: number;
        redemptionCount: number;
    } | null>;
    findOwnerWallet: (cafeId: string) => Promise<string | null>;
    readOwnerBalance: (wallet: string) => Promise<bigint>;
};

const findProjection: CafePayoutDeps["findProjection"] = async (cafeId) => {
    const [row] = await db
        .select({
            totalCentimos: projectionCafePayout.totalCentimos,
            redemptionCount: projectionCafePayout.redemptionCount,
        })
        .from(projectionCafePayout)
        .where(eq(projectionCafePayout.cafeId, cafeId))
        .limit(1);
    return row ?? null;
};

const findOwnerWallet: CafePayoutDeps["findOwnerWallet"] = async (cafeId) => {
    const [row] = await db
        .select({ walletAddress: user.walletAddress })
        .from(cafeMember)
        .innerJoin(user, eq(user.id, cafeMember.userId))
        .where(and(eq(cafeMember.cafeId, cafeId), eq(cafeMember.role, "owner")))
        .limit(1);
    return row?.walletAddress ?? null;
};

const readOwnerBalance: CafePayoutDeps["readOwnerBalance"] = async (wallet) => {
    const publicClient = createChainPublicClient();
    return publicClient.readContract({
        address: getAddresses().mockPEN,
        abi: abis.mockPEN,
        functionName: "balanceOf",
        args: [wallet as Address],
    });
};

const defaults: CafePayoutDeps = {
    requireMember: requireCafeRole,
    findProjection,
    findOwnerWallet,
    readOwnerBalance,
};

export async function getCafePayoutsService(
    userId: string,
    cafeId: string,
    deps: Partial<CafePayoutDeps> = {},
): Promise<AsyncAppResult<CafePayouts>> {
    try {
        const d = { ...defaults, ...deps };
        const membership = await d.requireMember(userId, cafeId, [
            "owner",
            "barista",
        ]);
        if (!membership.ok) return membership;

        const projection = await d.findProjection(cafeId);
        const ownerWallet = await d.findOwnerWallet(cafeId);
        let ownerMpenCentimos: number | null = null;
        if (ownerWallet) {
            try {
                // The token uses 10,000 base units per centimo. Integer
                // division deliberately truncates any fractional centimo.
                ownerMpenCentimos = Number(
                    (await d.readOwnerBalance(ownerWallet)) / 10_000n,
                );
            } catch {
                ownerMpenCentimos = null;
            }
        }

        return ok({
            totalCentimos: projection?.totalCentimos ?? 0,
            redemptionCount: projection?.redemptionCount ?? 0,
            ownerMpenCentimos,
        });
    } catch {
        return err(
            AppErrors.unexpected(new Error("café payout lookup failed")),
        );
    }
}
