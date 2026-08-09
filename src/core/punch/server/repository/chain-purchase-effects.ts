import "server-only";

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
    confirmedAt: Date;
};

type Transaction = Pick<DbClient, "select" | "insert" | "update">;

async function recordEffect(
    tx: Transaction,
    input: ChainPurchaseEffectsInput,
    kind: "campaign_qualification" | "crawl_step",
    targetId: string,
): Promise<boolean> {
    const [row] = await tx
        .insert(chainPurchaseEffect)
        .values({
            id: `chain-effect:${input.purchaseOrderId}:${kind}:${targetId}`,
            purchaseOrderId: input.purchaseOrderId,
            kind,
            targetId,
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
    return Boolean(row);
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
                id: input.purchaseOrderId,
                createdAt: input.confirmedAt,
            },
        )) &&
        (await recordEffect(tx, input, "campaign_qualification", campaign.id))
    ) {
        await unlockCampaignVoucher(tx as DbClient, {
            campaignId: campaign.id,
            consumerUserId: input.consumerUserId,
            cafeId: input.cafeId,
            expiresAt: campaign.windowEnd,
        });
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
    if (!nextStep || nextStep.cafeId !== input.cafeId) return;
    if (!(await recordEffect(tx, input, "crawl_step", nextStep.id))) {
        return;
    }
    const completedCafeIds = [...progress.completedCafeIds, input.cafeId];
    await advanceCrawlProgress(
        tx as DbClient,
        progress.id,
        completedCafeIds,
        completedCafeIds.length >= steps.length,
    );
    if (completedCafeIds.length >= steps.length) {
        await unlockCrawlVoucher(tx as DbClient, {
            crawlId: crawl.id,
            consumerUserId: input.consumerUserId,
            expiresAt: crawl.expiresAt,
        });
    }
}
