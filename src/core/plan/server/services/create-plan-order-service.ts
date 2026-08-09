import "server-only";

import { isAuthorizedCafeOperator } from "@/core/chain/server/cafe-authorization";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { priceForKind } from "@/core/plan/domain/schemas";
import type { CreatePlanOrder, PlanOrderView } from "@/core/plan/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { readPlanChainState } from "../repository/plan-chain-reader";
import { insertOrderIfIdle } from "../repository/plan-repository";
import { findCafeMembership } from "./get-plan-status-service";
import { toPlanOrderView } from "./plan-view";

export type CreatePlanOrderDeps = {
    findCafeMembership: typeof findCafeMembership;
    readChainState: (chainCafeId: number) => Promise<{
        planActive: boolean;
        unallocatedReserve: bigint;
    }>;
    isAuthorized: (input: {
        chainCafeId: number;
        walletAddress: `0x${string}`;
    }) => Promise<boolean>;
    ensureWallet: typeof assignWallet;
    insertOrderIfIdle: typeof insertOrderIfIdle;
};

const defaults: CreatePlanOrderDeps = {
    findCafeMembership,
    readChainState: (chainCafeId) => readPlanChainState(chainCafeId),
    isAuthorized: isAuthorizedCafeOperator,
    ensureWallet: assignWallet,
    insertOrderIfIdle,
};

export async function createPlanOrderService(
    userId: string,
    input: CreatePlanOrder,
    overrides: Partial<CreatePlanOrderDeps> = {},
): AsyncAppResult<PlanOrderView> {
    const d = { ...defaults, ...overrides };
    try {
        const membership = await d.findCafeMembership(userId, input.cafeId);
        if (!membership)
            return err(AppErrors.notFound({ targets: ["cafeId"] }));
        if (membership.chainCafeId === null) {
            return err(AppErrors.unprocessableEntity({ targets: ["cafeId"] }));
        }
        const chainCafeId = membership.chainCafeId;

        const wallet = await d.ensureWallet(userId);
        const authorized = await d.isAuthorized({
            chainCafeId,
            walletAddress: wallet.address as `0x${string}`,
        });
        if (!authorized) return err(AppErrors.forbidden());

        // The contract enforces these too; checking here turns a wasted
        // transaction into a clear message.
        const { planActive } = await d.readChainState(chainCafeId);
        if (input.kind === "pack" && !planActive) {
            return err(AppErrors.unprocessableEntity({ targets: ["kind"] }));
        }
        if (input.kind === "plan" && planActive) {
            return err(AppErrors.unprocessableEntity({ targets: ["kind"] }));
        }

        const result = await d.insertOrderIfIdle({
            id: crypto.randomUUID(),
            cafeId: input.cafeId,
            chainCafeId,
            userId,
            kind: input.kind,
            price: priceForKind(input.kind),
            signerAddress: wallet.address,
            signerWalletIndex: wallet.walletIndex,
        });
        if (!result.created) {
            return err(AppErrors.conflict({ targets: ["cafeId"] }));
        }
        return ok(toPlanOrderView(result.row));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
