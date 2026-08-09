import "server-only";

import { and, eq, like, sql } from "drizzle-orm";
import type { DbClient, db } from "@/server/drizzle/db";
import {
    indexerCursor,
    projectionCafeCredit,
    projectionCafePayout,
    projectionConsumption,
    projectionPunchBalance,
} from "@/server/drizzle/schemas/chain-schema";
import {
    consumerTransaction,
    consumptionProof,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";
import {
    chainPurchaseEffect,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";

type CampaignEffect = { createdVoucherId: string | null };
type CrawlEffect = {
    targetId: string;
    progressId: string | null;
    createdVoucherId: string | null;
};

async function reverseCampaignEffects(
    tx: DbClient,
    effects: CampaignEffect[],
): Promise<void> {
    for (const effect of effects) {
        if (!effect.createdVoucherId) continue;
        await tx
            .delete(consumerVoucher)
            .where(
                and(
                    eq(consumerVoucher.id, effect.createdVoucherId),
                    eq(consumerVoucher.source, "campaign"),
                    eq(consumerVoucher.status, "available"),
                ),
            );
    }
}

async function reverseCrawlEffects(
    tx: DbClient,
    effects: CrawlEffect[],
): Promise<void> {
    for (const effect of effects) {
        if (effect.progressId) {
            const [step] = await tx
                .select({ cafeId: coffeeCrawlStep.cafeId })
                .from(coffeeCrawlStep)
                .where(eq(coffeeCrawlStep.id, effect.targetId));
            const [progress] = await tx
                .select()
                .from(consumerCrawlProgress)
                .where(eq(consumerCrawlProgress.id, effect.progressId));
            if (step && progress) {
                await tx
                    .update(consumerCrawlProgress)
                    .set({
                        completedCafeIds: progress.completedCafeIds.filter(
                            (cafeId) => cafeId !== step.cafeId,
                        ),
                        status: "in_progress",
                    })
                    .where(eq(consumerCrawlProgress.id, progress.id));
            }
        }
        if (effect.createdVoucherId) {
            await tx
                .delete(consumerVoucher)
                .where(
                    and(
                        eq(consumerVoucher.id, effect.createdVoucherId),
                        eq(consumerVoucher.source, "crawl"),
                        eq(consumerVoucher.status, "available"),
                    ),
                );
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
                progressId: chainPurchaseEffect.progressId,
                createdVoucherId: chainPurchaseEffect.createdVoucherId,
            })
            .from(chainPurchaseEffect);
        await reverseCampaignEffects(
            tx,
            effects
                .filter((effect) => effect.kind === "campaign_qualification")
                .map((effect) => ({
                    createdVoucherId: effect.createdVoucherId,
                })),
        );
        await reverseCrawlEffects(
            tx,
            effects
                .filter((effect) => effect.kind === "crawl_step")
                .map((effect) => ({
                    targetId: effect.targetId,
                    progressId: effect.progressId,
                    createdVoucherId: effect.createdVoucherId,
                })),
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
            .delete(consumerTransaction)
            .where(
                and(
                    eq(consumerTransaction.operation, "punch_redemption"),
                    like(
                        consumerTransaction.idempotencyKey,
                        "chain_redemption:%",
                    ),
                ),
            );
        await tx
            .update(redemptionRequest)
            .set({ status: "approved" })
            .where(eq(redemptionRequest.status, "confirmed"));
        await tx.delete(projectionCafePayout).where(sql`true`);
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
