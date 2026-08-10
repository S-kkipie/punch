import "server-only";

import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { chainPurchaseEffect } from "@/server/drizzle/schemas/punch-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import {
    enqueueCampaignUnlock,
    findActiveCampaignForCafe,
    hasPriorPaidPurchase,
} from "./campaigns";
import {
    advanceCrawlProgress,
    findActiveCrawlForCafe,
    getCrawlSteps,
    getOrCreateCrawlProgress,
    unlockCrawlVoucher,
} from "./crawls";

export type ChainPurchaseEffectsInput = {
    purchaseOrderId: string;
    consumerUserId: string;
    cafeId: string;
    productId: string;
    transactionHash: string;
    logIndex: number;
    blockNumber: bigint;
    confirmedAt: Date;
};

type Transaction = Pick<DbClient, "select" | "insert" | "update">;

async function recordEffect(
    tx: Transaction,
    input: ChainPurchaseEffectsInput,
    kind: "campaign_qualification" | "crawl_step",
    targetId: string,
    progressId?: string,
): Promise<{ id: string } | null> {
    const [row] = await tx
        .insert(chainPurchaseEffect)
        .values({
            id: `chain-effect:${input.purchaseOrderId}:${kind}:${targetId}`,
            purchaseOrderId: input.purchaseOrderId,
            kind,
            targetId,
            progressId,
            transactionHash: input.transactionHash,
            logIndex: input.logIndex,
        })
        .onConflictDoNothing({
            target: [
                chainPurchaseEffect.purchaseOrderId,
                chainPurchaseEffect.kind,
                chainPurchaseEffect.targetId,
            ],
        })
        .returning({ id: chainPurchaseEffect.id });
    return row ?? null;
}

export async function applyChainPurchaseEffects(
    tx: Transaction,
    input: ChainPurchaseEffectsInput,
): Promise<void> {
    const campaign = await findActiveCampaignForCafe(
        tx as DbClient,
        input.cafeId,
    );
    if (
        campaign &&
        !(await hasPriorPaidPurchase(
            tx as DbClient,
            input.consumerUserId,
            input.cafeId,
            {
                id: `chain_emission:${input.purchaseOrderId}`,
                createdAt: input.confirmedAt,
                chainBlockNumber: input.blockNumber,
                logIndex: input.logIndex,
            },
        ))
    ) {
        const effect = await recordEffect(
            tx,
            input,
            "campaign_qualification",
            campaign.id,
        );
        if (effect && campaign.chainCampaignId !== null) {
            const [consumer] = await tx
                .select({ walletAddress: user.walletAddress })
                .from(user)
                .where(eq(user.id, input.consumerUserId));
            if (!consumer?.walletAddress) {
                throw new Error(
                    "consumer wallet address is required for campaign unlock",
                );
            }
            await enqueueCampaignUnlock(tx, {
                chainCampaignId: campaign.chainCampaignId,
                userAddress: consumer.walletAddress,
                effectId: effect.id,
            });
        }
    }

    const crawl = await findActiveCrawlForCafe(tx as DbClient, input.cafeId);
    if (!crawl) return;
    const steps = await getCrawlSteps(tx as DbClient, crawl.id);
    const progress = await getOrCreateCrawlProgress(
        tx as DbClient,
        crawl.id,
        input.consumerUserId,
    );
    const nextIndex = progress.completedCafeIds.length;
    const nextStep = steps[nextIndex];
    const alreadyCompletedStep = steps.find(
        (step) =>
            step.cafeId === input.cafeId &&
            progress.completedCafeIds.includes(input.cafeId),
    );
    if (alreadyCompletedStep && !nextStep) {
        // Replaying the order that originally completed this step finds no
        // surviving claim (the rebuild cleared it); a later repeat purchase at
        // the same café finds the replayed claim and must not record a second
        // effect with false provenance.
        const [claimed] = await tx
            .select({ id: chainPurchaseEffect.id })
            .from(chainPurchaseEffect)
            .innerJoin(
                purchaseOrder,
                eq(purchaseOrder.id, chainPurchaseEffect.purchaseOrderId),
            )
            .where(
                and(
                    eq(chainPurchaseEffect.kind, "crawl_step"),
                    eq(chainPurchaseEffect.targetId, alreadyCompletedStep.id),
                    eq(purchaseOrder.userId, input.consumerUserId),
                ),
            );
        if (claimed) return;
        const effect = await recordEffect(
            tx,
            input,
            "crawl_step",
            alreadyCompletedStep.id,
            progress.id,
        );
        if (effect && progress.completedCafeIds.length >= steps.length) {
            const voucher = await unlockCrawlVoucher(tx as DbClient, {
                crawlId: crawl.id,
                consumerUserId: input.consumerUserId,
                expiresAt: crawl.expiresAt,
            });
            if (voucher) {
                await tx
                    .update(chainPurchaseEffect)
                    .set({ createdVoucherId: voucher.id })
                    .where(eq(chainPurchaseEffect.id, effect.id));
            }
        }
        return;
    }
    if (!nextStep || nextStep.cafeId !== input.cafeId) return;
    const effect = await recordEffect(
        tx,
        input,
        "crawl_step",
        nextStep.id,
        progress.id,
    );
    if (!effect) return;

    const completedCafeIds = [...progress.completedCafeIds, input.cafeId];
    await advanceCrawlProgress(
        tx as DbClient,
        progress.id,
        completedCafeIds,
        completedCafeIds.length >= steps.length,
    );
    if (completedCafeIds.length >= steps.length) {
        const voucher = await unlockCrawlVoucher(tx as DbClient, {
            crawlId: crawl.id,
            consumerUserId: input.consumerUserId,
            expiresAt: crawl.expiresAt,
        });
        if (voucher) {
            await tx
                .update(chainPurchaseEffect)
                .set({ createdVoucherId: voucher.id })
                .where(eq(chainPurchaseEffect.id, effect.id));
        }
    }
}
