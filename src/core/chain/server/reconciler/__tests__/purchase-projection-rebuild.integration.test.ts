import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { applyConfirmedConsumptionProjection } from "@/core/chain/server/indexer/purchase-projection";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
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
    campaign,
    chainPurchaseEffect,
    consumerVoucher,
    punchBalanceProjection,
} from "@/server/drizzle/schemas/punch-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import { clearChainDerivedPurchaseProjections } from "../purchase-projection-rebuild";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

const fixtures: string[] = [];

describeIntegration("clearChainDerivedPurchaseProjections", () => {
    it("removes chain-derived state while preserving definitions and manual vouchers", async () => {
        const suffix = crypto.randomUUID();
        const userId = `rebuild-user-${suffix}`;
        const cafeId = `rebuild-cafe-${suffix}`;
        const productId = `rebuild-product-${suffix}`;
        const campaignId = `rebuild-campaign-${suffix}`;
        const manualCampaignId = `rebuild-manual-campaign-${suffix}`;
        const orderId = `rebuild-order-${suffix}`;
        const proofId = `rebuild-proof-${suffix}`;
        const manualVoucherId = `rebuild-manual-voucher-${suffix}`;
        const txHash =
            `0x${suffix.replaceAll("-", "").padStart(64, "0")}` as `0x${string}`;
        const chainCafeId = 990000 + Math.floor(Math.random() * 9000);
        fixtures.push(userId);

        await db.insert(user).values({
            id: userId,
            name: "Rebuild User",
            email: `${suffix}@rebuild.invalid`,
        });
        await db.insert(cafe).values({
            id: cafeId,
            name: "Rebuild Cafe",
            slug: suffix,
            chainCafeId,
            onboardingStatus: "approved",
        });
        await db.insert(cafeProduct).values({
            id: productId,
            cafeId,
            name: "Coffee",
            priceSoles: "8",
            type: "emission",
            approvalStatus: "approved",
            active: true,
            chainProductId: 991002,
        });
        await db.insert(campaign).values({
            id: campaignId,
            kind: "verified_acquisition",
            cafeId,
            name: "Campaign",
            windowStart: new Date(Date.now() - 60_000),
            windowEnd: new Date(Date.now() + 60_000),
            active: true,
        });
        await db.insert(campaign).values({
            id: manualCampaignId,
            kind: "verified_acquisition",
            cafeId,
            name: "Manual Campaign",
            windowStart: new Date(Date.now() - 60_000),
            windowEnd: new Date(Date.now() + 60_000),
            active: true,
        });
        await db.insert(consumerVoucher).values({
            id: manualVoucherId,
            source: "campaign",
            campaignId: manualCampaignId,
            consumerUserId: userId,
            cafeId,
            status: "available",
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(Date.now() - 60_000),
        });
        await db.insert(purchaseOrder).values({
            id: orderId,
            cafeId,
            userId,
            productId,
            amount: 8_000_000n,
            yapeRef: "rebuild-ref",
            receiptHash: `0x${"ab".repeat(32)}`,
            nonce: suffix,
            expiry: new Date(Date.now() + 60_000),
            status: "submitted",
        });
        await db.insert(consumptionProof).values({
            id: proofId,
            cafeId,
            productId,
            issuedByUserId: userId,
            consumerUserId: userId,
            amountCentimos: 800,
            purchaseOrderId: orderId,
            yapeRef: "rebuild-ref",
            receiptHash: `0x${"ab".repeat(32)}`,
            nonce: suffix,
            status: "submitted",
            expiresAt: new Date(Date.now() + 60_000),
        });
        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId,
                txHash,
                logIndex: 0,
                blockNumber: 12n,
            });
        });
        await db.insert(punchBalanceProjection).values({ userId, balance: 12 });
        await db.insert(projectionPunchBalance).values({
            userAddress: userId,
            balance: 12n,
            lastBlock: 12n,
        });
        await db
            .insert(projectionCafeCredit)
            .values({ chainCafeId, credits: 4n, lastBlock: 12n });
        await db.insert(projectionConsumption).values({
            id: `rebuild-consumption-${suffix}`,
            chainCafeId,
            userAddress: userId,
            receiptHash: `0x${"cd".repeat(32)}`,
            txHash,
            block: 12n,
            logIndex: 1,
        });
        await db
            .insert(indexerCursor)
            .values({ contract: "punch", lastProcessedBlock: 12n })
            .onConflictDoUpdate({
                target: indexerCursor.contract,
                set: { lastProcessedBlock: 12n },
            });

        await clearChainDerivedPurchaseProjections(db);

        expect(
            await db
                .select()
                .from(chainPurchaseEffect)
                .where(eq(chainPurchaseEffect.purchaseOrderId, orderId)),
        ).toEqual([]);
        expect(
            await db
                .select()
                .from(consumerTransaction)
                .where(eq(consumerTransaction.purchaseOrderId, orderId)),
        ).toEqual([]);
        expect(
            (
                await db
                    .select({ status: purchaseOrder.status })
                    .from(purchaseOrder)
                    .where(eq(purchaseOrder.id, orderId))
            )[0]?.status,
        ).toBe("submitted");
        expect(
            (
                await db
                    .select({ status: consumptionProof.status })
                    .from(consumptionProof)
                    .where(eq(consumptionProof.id, proofId))
            )[0]?.status,
        ).toBe("submitted");
        expect(await db.select().from(projectionPunchBalance)).toEqual([]);
        expect(await db.select().from(projectionCafeCredit)).toEqual([]);
        expect(await db.select().from(projectionConsumption)).toEqual([]);
        expect(
            (
                await db
                    .select({ block: indexerCursor.lastProcessedBlock })
                    .from(indexerCursor)
                    .where(eq(indexerCursor.contract, "punch"))
            )[0]?.block,
        ).toBe(0n);
        expect(
            await db.select().from(campaign).where(eq(campaign.id, campaignId)),
        ).toHaveLength(1);
        expect(
            await db
                .select()
                .from(consumerVoucher)
                .where(eq(consumerVoucher.id, manualVoucherId)),
        ).toHaveLength(1);

        await db.transaction(async (tx) => {
            await applyConfirmedConsumptionProjection(tx, {
                orderId,
                txHash,
                logIndex: 0,
                blockNumber: 12n,
            });
        });
        expect(
            await db
                .select()
                .from(consumerTransaction)
                .where(eq(consumerTransaction.purchaseOrderId, orderId)),
        ).toHaveLength(1);
    });
});

afterEach(async () => {
    for (const userId of fixtures.splice(0)) {
        const orders = await db
            .select({ id: purchaseOrder.id })
            .from(purchaseOrder)
            .where(eq(purchaseOrder.userId, userId));
        const orderIds = orders.map((row) => row.id);
        if (orderIds.length)
            await db
                .delete(consumerTransaction)
                .where(inArray(consumerTransaction.purchaseOrderId, orderIds));
        if (orderIds.length)
            await db
                .delete(chainPurchaseEffect)
                .where(inArray(chainPurchaseEffect.purchaseOrderId, orderIds));
        await db
            .delete(consumptionProof)
            .where(eq(consumptionProof.issuedByUserId, userId));
        await db.delete(purchaseOrder).where(eq(purchaseOrder.userId, userId));
        await db
            .delete(consumerVoucher)
            .where(eq(consumerVoucher.consumerUserId, userId));
        await db
            .delete(punchBalanceProjection)
            .where(eq(punchBalanceProjection.userId, userId));
        await db
            .delete(campaign)
            .where(
                inArray(campaign.id, [
                    `rebuild-campaign-${userId.slice("rebuild-user-".length)}`,
                    `rebuild-manual-campaign-${userId.slice("rebuild-user-".length)}`,
                ]),
            );
        await db
            .delete(cafeProduct)
            .where(
                eq(
                    cafeProduct.cafeId,
                    `rebuild-cafe-${userId.slice("rebuild-user-".length)}`,
                ),
            );
        await db
            .delete(cafe)
            .where(
                eq(
                    cafe.id,
                    `rebuild-cafe-${userId.slice("rebuild-user-".length)}`,
                ),
            );
        await db.delete(user).where(eq(user.id, userId));
    }
});
