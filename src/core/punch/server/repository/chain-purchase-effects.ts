import "server-only";

import { eq } from "drizzle-orm";
import type { DbClient } from "@/server/drizzle/db";
import { chainPurchaseEffect } from "@/server/drizzle/schemas/punch-schema";
import {
    findActiveCampaignForCafe,
    hasPriorPaidPurchase,
    unlockCampaignVoucher,
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
        if (effect) {
            const voucher = await unlockCampaignVoucher(tx as DbClient, {
                campaignId: campaign.id,
                consumerUserId: input.consumerUserId,
                cafeId: input.cafeId,
                expiresAt: campaign.windowEnd,
            });
            // The (campaignId, consumerUserId) slot admits one voucher, and every
            // production voucher comes from these unlock paths, so an existing
            // available voucher converges to chain provenance here. Redeemed
            // vouchers stay out of reach: reversal only deletes 'available' rows.
            if (voucher) {
                await tx
                    .update(chainPurchaseEffect)
                    .set({ createdVoucherId: voucher.id })
                    .where(eq(chainPurchaseEffect.id, effect.id));
            }
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
