import "server-only";

import { and, eq } from "drizzle-orm";
import { isAuthorizedCafeOperator } from "@/core/chain/server/cafe-authorization";
import { mpenToSoles } from "@/core/plan/domain/schemas";
import type { PlanStatusView } from "@/core/plan/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeMember } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCafeCredit } from "@/server/drizzle/schemas/chain-schema";
import { readPlanChainState } from "../repository/plan-chain-reader";
import { findInFlightByCafe } from "../repository/plan-repository";

export type CafeMembership = {
    chainCafeId: number | null;
    walletAddress: string | null;
};

export async function findCafeMembership(
    userId: string,
    cafeId: string,
): Promise<CafeMembership | null> {
    const [row] = await db
        .select({
            chainCafeId: cafe.chainCafeId,
            walletAddress: user.walletAddress,
        })
        .from(cafeMember)
        .innerJoin(cafe, eq(cafe.id, cafeMember.cafeId))
        .innerJoin(user, eq(user.id, cafeMember.userId))
        .where(
            and(eq(cafeMember.userId, userId), eq(cafeMember.cafeId, cafeId)),
        )
        .limit(1);
    return row ?? null;
}

async function readCredits(chainCafeId: number): Promise<bigint | null> {
    const [row] = await db
        .select({ credits: projectionCafeCredit.credits })
        .from(projectionCafeCredit)
        .where(eq(projectionCafeCredit.chainCafeId, chainCafeId))
        .limit(1);
    return row?.credits ?? null;
}

export type PlanStatusDeps = {
    findCafeMembership: typeof findCafeMembership;
    readChainState: (chainCafeId: number) => Promise<{
        planActive: boolean;
        unallocatedReserve: bigint;
    }>;
    readCredits: (chainCafeId: number) => Promise<bigint | null>;
    isAuthorized: (input: {
        chainCafeId: number;
        walletAddress: `0x${string}`;
    }) => Promise<boolean>;
    findInFlight: (cafeId: string) => Promise<{ id: string } | null>;
};

const defaults: PlanStatusDeps = {
    findCafeMembership,
    readChainState: (chainCafeId) => readPlanChainState(chainCafeId),
    readCredits,
    isAuthorized: isAuthorizedCafeOperator,
    findInFlight: findInFlightByCafe,
};

export async function getPlanStatusService(
    userId: string,
    cafeId: string,
    overrides: Partial<PlanStatusDeps> = {},
): AsyncAppResult<PlanStatusView> {
    const d = { ...defaults, ...overrides };
    try {
        const membership = await d.findCafeMembership(userId, cafeId);
        if (!membership)
            return err(AppErrors.notFound({ targets: ["cafeId"] }));
        const { chainCafeId, walletAddress } = membership;
        if (chainCafeId === null) {
            return err(AppErrors.unprocessableEntity({ targets: ["cafeId"] }));
        }

        const [chainState, credits, inFlight] = await Promise.all([
            d.readChainState(chainCafeId),
            d.readCredits(chainCafeId),
            d.findInFlight(cafeId),
        ]);
        const canPay = walletAddress
            ? await d.isAuthorized({
                  chainCafeId,
                  walletAddress: walletAddress as `0x${string}`,
              })
            : false;

        return ok({
            cafeId,
            planActive: chainState.planActive,
            credits: Number(credits ?? 0n),
            unallocatedReserveSoles: mpenToSoles(chainState.unallocatedReserve),
            canPay,
            inFlightOrderId: inFlight?.id ?? null,
        });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
