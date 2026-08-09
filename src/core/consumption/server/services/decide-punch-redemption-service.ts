import "server-only";

import { eq } from "drizzle-orm";
import { findUserWallet } from "@/core/chain/server/wallet/repository";
import type {
    DecideRedemptionRequest,
    RedemptionRequest,
} from "@/core/consumption/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import {
    approveRedemptionAndEnqueueJob,
    decideRedemptionRequest,
    findRedemptionRequestById,
    RedemptionRequestRepositoryError,
} from "../repository/redemption-requests";
import { toRedemptionRequest } from "../repository/utils";

type DecidePunchDeps = {
    requireCafeRole: typeof requireCafeRole;
    findRequest: typeof findRedemptionRequestById;
    decideRequest: typeof decideRedemptionRequest;
    approveAndEnqueue: typeof approveRedemptionAndEnqueueJob;
    findUserWallet: typeof findUserWallet;
    findCafeChainMapping: (
        cafeId: string,
    ) => Promise<{ chainCafeId: number | null }>;
    findProductChainMapping: (
        productId: string,
    ) => Promise<{ chainProductId: number | null }>;
};

const defaultDeps: DecidePunchDeps = {
    requireCafeRole,
    findRequest: findRedemptionRequestById,
    decideRequest: decideRedemptionRequest,
    approveAndEnqueue: approveRedemptionAndEnqueueJob,
    findUserWallet,
    findCafeChainMapping: async (cafeId) => {
        const [row] = await db
            .select({ chainCafeId: cafe.chainCafeId })
            .from(cafe)
            .where(eq(cafe.id, cafeId));
        return { chainCafeId: row?.chainCafeId ?? null };
    },
    findProductChainMapping: async (productId) => {
        const [row] = await db
            .select({ chainProductId: cafeProduct.chainProductId })
            .from(cafeProduct)
            .where(eq(cafeProduct.id, productId));
        return { chainProductId: row?.chainProductId ?? null };
    },
};

export async function decidePunchRedemptionService(
    deciderUserId: string,
    cafeId: string,
    requestId: string,
    input: DecideRedemptionRequest,
    deps: Partial<DecidePunchDeps> = {},
): AsyncAppResult<RedemptionRequest> {
    const d = { ...defaultDeps, ...deps };
    const membershipResult = await d.requireCafeRole(deciderUserId, cafeId, [
        "owner",
        "barista",
    ]);
    if (!membershipResult.ok) return err(membershipResult.error);

    const existing = await d.findRequest(requestId);
    if (
        !existing ||
        existing.cafeId !== cafeId ||
        existing.kind !== "punch_reward"
    ) {
        return err(AppErrors.notFound({ targets: ["requestId"] }));
    }

    if (existing.status === "rejected") {
        if (
            input.decision === "rejected" &&
            input.rejectionReason === existing.rejectionReason
        ) {
            return ok(toRedemptionRequest(existing));
        }
        return err(AppErrors.conflict({ targets: ["requestId"] }));
    }

    try {
        if (input.decision === "rejected") {
            const request = await d.decideRequest(
                requestId,
                deciderUserId,
                "rejected",
                input.rejectionReason ?? null,
            );
            return ok(toRedemptionRequest(request));
        }

        const wallet = await d.findUserWallet(existing.consumerUserId);
        if (!wallet?.walletAddress) {
            return err(AppErrors.unprocessableEntity({ targets: ["wallet"] }));
        }
        if (!existing.productId) {
            return err(
                AppErrors.unprocessableEntity({ targets: ["chainMapping"] }),
            );
        }
        const cafeMapping = await d.findCafeChainMapping(existing.cafeId);
        const productMapping = await d.findProductChainMapping(
            existing.productId,
        );
        const chainCafeId = cafeMapping.chainCafeId;
        const chainProductId = productMapping.chainProductId;
        if (chainCafeId === null || chainProductId === null) {
            return err(
                AppErrors.unprocessableEntity({ targets: ["chainMapping"] }),
            );
        }
        const request = await d.approveAndEnqueue(requestId, deciderUserId, {
            userWallet: wallet.walletAddress,
            chainCafeId,
            chainProductId,
        });
        return ok(toRedemptionRequest(request));
    } catch (cause) {
        if (cause instanceof RedemptionRequestRepositoryError) {
            if (cause.code === "REQUEST_NOT_FOUND") {
                return err(AppErrors.notFound({ targets: ["requestId"] }));
            }
            return err(AppErrors.conflict({ targets: ["requestId"] }));
        }
        return err(AppErrors.unexpected(cause));
    }
}
