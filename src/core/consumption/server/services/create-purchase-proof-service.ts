import "server-only";

import { findCafeById } from "@/core/cafe/server/repository/find-cafe-by-id";
import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { isAuthorizedCafeOperator } from "@/core/chain/server/cafe-authorization";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import type { CreatePurchaseProof } from "@/core/consumption/domain/types";
import { solesToMpen } from "@/core/purchase/domain/schemas";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { createQuote } from "../repository/proofs";

export type PurchaseProofIssued = {
    id: string;
    expiresAt: string;
    deepLink: string;
};

export async function createPurchaseProofService(
    baristaUserId: string,
    cafeId: string,
    input: CreatePurchaseProof,
): AsyncAppResult<PurchaseProofIssued> {
    const membershipResult = await requireCafeRole(baristaUserId, cafeId, [
        "owner",
        "barista",
    ]);
    if (!membershipResult.ok) return err(membershipResult.error);

    const cafeRow = await findCafeById(cafeId);
    if (
        cafeRow?.onboardingStatus !== "approved" ||
        cafeRow.chainCafeId === null
    ) {
        return err(AppErrors.notFound({ targets: ["cafeId"] }));
    }

    const product = await findProductById(input.productId);
    if (!product || product.cafeId !== cafeId) {
        return err(AppErrors.notFound({ targets: ["productId"] }));
    }
    let amountMpen: bigint;
    try {
        amountMpen = solesToMpen(Number(product.priceSoles));
    } catch {
        amountMpen = 0n;
    }
    const amountCentimos = Number(amountMpen / 10_000n);
    if (
        product.type !== "emission" ||
        product.approvalStatus !== "approved" ||
        !product.active ||
        product.chainProductId === null ||
        amountCentimos <= 0 ||
        amountMpen < 8_000_000n
    ) {
        return err(
            AppErrors.unprocessableEntity({
                targets: ["productId"],
                cause: "Este producto no puede emitir PUNCH.",
            }),
        );
    }

    const wallet = await assignWallet(baristaUserId);
    const authorized = await isAuthorizedCafeOperator({
        chainCafeId: cafeRow.chainCafeId,
        walletAddress: wallet.address as `0x${string}`,
    });
    if (!authorized) {
        return err(AppErrors.unprocessableEntity({ targets: ["operator"] }));
    }

    const row = await createQuote({
        cafeId,
        productId: input.productId,
        issuedByUserId: baristaUserId,
        amountCentimos,
        yapeRef: input.yapeRef,
        status: "issued",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        receiptHash: null,
        nonce: null,
        cafeSignature: null,
    });

    return ok({
        id: row.id,
        expiresAt: row.expiresAt.toISOString(),
        deepLink: `/purchase/${row.id}`,
    });
}
