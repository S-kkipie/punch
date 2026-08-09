import "server-only";

import { and, eq, like, sql } from "drizzle-orm";
import type { DbClient, db } from "@/server/drizzle/db";
import {
    indexerCursor,
    projectionCafeCredit,
    projectionConsumption,
    projectionPunchBalance,
} from "@/server/drizzle/schemas/chain-schema";
import {
    consumerTransaction,
    consumptionProof,
} from "@/server/drizzle/schemas/consumption-schema";
import {
    chainPurchaseEffect,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";

async function reverseCampaignEffects(
    tx: DbClient,
    effects: Array<{ targetId: string; purchaseOrderId: string }>,
): Promise<void> {
    for (const effect of effects) {
        const [order] = await tx
            .select({
                userId: purchaseOrder.userId,
                createdAt: purchaseOrder.createdAt,
            })
            .from(purchaseOrder)
            .where(eq(purchaseOrder.id, effect.purchaseOrderId));
        if (!order) continue;
        const vouchers = await tx
            .select({ id: consumerVoucher.id })
            .from(consumerVoucher)
            .where(
                and(
                    eq(consumerVoucher.source, "campaign"),
                    eq(consumerVoucher.campaignId, effect.targetId),
                    eq(consumerVoucher.consumerUserId, order.userId),
                    sql`${consumerVoucher.createdAt} > ${order.createdAt}`,
                ),
            );
        for (const voucher of vouchers) {
            await tx
                .delete(consumerVoucher)
                .where(eq(consumerVoucher.id, voucher.id));
        }
    }
}

async function reverseCrawlEffects(
    tx: DbClient,
    effects: Array<{ targetId: string; purchaseOrderId: string }>,
): Promise<void> {
    for (const effect of effects) {
        const [step] = await tx
            .select({
                crawlId: coffeeCrawlStep.crawlId,
                cafeId: coffeeCrawlStep.cafeId,
            })
            .from(coffeeCrawlStep)
            .where(eq(coffeeCrawlStep.id, effect.targetId));
        if (!step) continue;
        const [order] = await tx
            .select({
                userId: purchaseOrder.userId,
                createdAt: purchaseOrder.createdAt,
            })
            .from(purchaseOrder)
            .where(eq(purchaseOrder.id, effect.purchaseOrderId));
        if (!order) continue;
        const [progress] = await tx
            .select()
            .from(consumerCrawlProgress)
            .where(
                and(
                    eq(consumerCrawlProgress.crawlId, step.crawlId),
                    eq(consumerCrawlProgress.consumerUserId, order.userId),
                ),
            );
        if (progress) {
            const completedCafeIds = progress.completedCafeIds.filter(
                (cafeId) => cafeId !== step.cafeId,
            );
            await tx
                .update(consumerCrawlProgress)
                .set({ completedCafeIds, status: "in_progress" })
                .where(eq(consumerCrawlProgress.id, progress.id));
        }
        const vouchers = await tx
            .select({ id: consumerVoucher.id })
            .from(consumerVoucher)
            .where(
                and(
                    eq(consumerVoucher.source, "crawl"),
                    eq(consumerVoucher.crawlId, step.crawlId),
                    eq(consumerVoucher.consumerUserId, order.userId),
                    sql`${consumerVoucher.createdAt} > ${order.createdAt}`,
                ),
            );
        for (const voucher of vouchers) {
            await tx
                .delete(consumerVoucher)
                .where(eq(consumerVoucher.id, voucher.id));
        }
    }
}

export async function clearChainDerivedPurchaseProjections(
    database: typeof db,
): Promise<void> {
    await database.transaction(async (tx) => {
        const effects = await tx
            .select({
                kind: chainPurchaseEffect.kind,
                targetId: chainPurchaseEffect.targetId,
                purchaseOrderId: chainPurchaseEffect.purchaseOrderId,
            })
            .from(chainPurchaseEffect);
        await reverseCampaignEffects(
            tx,
            effects.filter(
                (effect) => effect.kind === "campaign_qualification",
            ),
        );
        await reverseCrawlEffects(
            tx,
            effects.filter((effect) => effect.kind === "crawl_step"),
        );

        await tx.delete(chainPurchaseEffect).where(sql`true`);
        await tx
            .delete(consumerTransaction)
            .where(
                and(
                    eq(consumerTransaction.operation, "emission"),
                    like(
                        consumerTransaction.idempotencyKey,
                        "chain_emission:%",
                    ),
                ),
            );
        await tx
            .update(consumptionProof)
            .set({ status: "submitted" })
            .where(eq(consumptionProof.status, "confirmed"));
        await tx
            .update(purchaseOrder)
            .set({ status: "submitted", txHash: null })
            .where(eq(purchaseOrder.status, "confirmed"));

        await tx.delete(projectionConsumption).where(sql`true`);
        await tx.delete(projectionPunchBalance).where(sql`true`);
        await tx.delete(projectionCafeCredit).where(sql`true`);
        await tx
            .insert(indexerCursor)
            .values({ contract: "punch", lastProcessedBlock: 0n })
            .onConflictDoUpdate({
                target: indexerCursor.contract,
                set: { lastProcessedBlock: 0n },
            });
    });
}
