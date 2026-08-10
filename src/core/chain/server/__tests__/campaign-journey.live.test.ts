import { and, eq, inArray, like, sql } from "drizzle-orm";
import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCampaignService } from "@/core/campaign/server/services/create-campaign-service";
import { fundCampaignService } from "@/core/campaign/server/services/fund-campaign-service";
import { publishCampaignService } from "@/core/campaign/server/services/publish-campaign-service";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import {
    recoverStuckJobs,
    runRelayerOnce,
} from "@/core/chain/server/relayer/relayer";
import { createPurchaseProofService } from "@/core/consumption/server/services/create-purchase-proof-service";
import { decideVoucherRedemptionService } from "@/core/consumption/server/services/decide-voucher-redemption-service";
import { requestVoucherRedemptionService } from "@/core/consumption/server/services/request-voucher-redemption-service";
import { confirmQuoteService } from "@/core/purchase/server/services/confirm-quote-service";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import {
    cafe,
    cafeMember,
    cafeProduct,
} from "@/server/drizzle/schemas/cafe-schema";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";
import {
    consumerTransaction,
    consumptionProof,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";
import {
    campaign,
    chainPurchaseEffect,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import {
    purchaseOrder,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";

const live =
    process.env.PUNCH_RUN_INTEGRATION === "1" &&
    process.env.PUNCH_RUN_LIVE_CHAIN === "1";
const describeLive = describe.skipIf(!live);
const payout = 1_000_000n;
const cap = 1;
const budget = payout * BigInt(cap);
const suffix = crypto.randomUUID();
const yapePrefix = `LIVE-CAMPAIGN-${suffix}`;

let ownerId = "";
let ownerAddress = "";
let consumerId = "";
let consumerAddress = "";
let baristaId = "";
let cafeId = "";
let productId = "";
let campaignId = "";
let chainCampaignId = 0;
let firstOrderId = "";
let secondOrderId = "";
let voucherId = "";
let redemptionRequestId = "";
let demoCampaignStates: { id: string; active: boolean }[] = [];

const chain = createPublicClient({
    chain: foundry,
    transport: http(process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545"),
});
const addresses = getAddresses();

async function drainRelayerAndIndexer() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
        await recoverStuckJobs();
        await runRelayerOnce();
        await runIndexerOnce();
    }
}

async function findFixture() {
    const [consumer] = await db
        .select({ id: user.id, walletAddress: user.walletAddress })
        .from(user)
        .where(eq(user.email, "demo-consumer@punch.pe"));
    const [owner] = await db
        .select({ id: user.id, walletAddress: user.walletAddress })
        .from(user)
        .innerJoin(cafeMember, eq(cafeMember.userId, user.id))
        .where(
            and(
                eq(cafeMember.role, "owner"),
                eq(user.email, "esquinasur@punch.pe"),
            ),
        );
    const [barista] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, "esquinasur@punch.pe"));
    const [targetCafe] = await db
        .select({ id: cafe.id })
        .from(cafe)
        .where(eq(cafe.slug, "esquina-sur"));
    if (
        !consumer?.walletAddress ||
        !owner?.walletAddress ||
        !barista ||
        !targetCafe
    )
        throw new Error("campaign journey seed precondition is missing");
    const [product] = await db
        .select({ id: cafeProduct.id })
        .from(cafeProduct)
        .where(
            and(
                eq(cafeProduct.cafeId, targetCafe.id),
                eq(cafeProduct.type, "emission"),
            ),
        )
        .limit(1);
    if (!product) throw new Error("campaign journey target product is missing");
    ownerId = owner.id;
    ownerAddress = owner.walletAddress;
    consumerId = consumer.id;
    consumerAddress = consumer.walletAddress;
    baristaId = barista.id;
    cafeId = targetCafe.id;
    productId = product.id;
}

async function createPurchase(label: string) {
    const issued = await createPurchaseProofService(baristaId, cafeId, {
        productId,
        yapeRef: `${yapePrefix}-${label}`,
    });
    expect(
        issued.ok,
        issued.ok ? undefined : JSON.stringify(issued.error),
    ).toBe(true);
    if (!issued.ok) throw new Error("campaign journey quote issuance failed");
    const confirmed = await confirmQuoteService(consumerId, issued.data.id);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok)
        throw new Error("campaign journey quote confirmation failed");
    return confirmed.data.order.id;
}

describeLive("live campaign journey and chain projections", () => {
    beforeAll(async () => {
        await findFixture();
        const ownerBalance = await chain.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [ownerAddress as `0x${string}`],
        });
        if (ownerBalance < budget) {
            const deployer = mnemonicToAccount(
                "test test test test test test test test test test test junk",
                { addressIndex: 0 },
            );
            const deployerWallet = createWalletClient({
                account: deployer,
                chain: foundry,
                transport: http(
                    process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545",
                ),
            });
            const mintHash = await deployerWallet.writeContract({
                address: addresses.mockPEN,
                abi: abis.mockPEN,
                functionName: "mint",
                args: [ownerAddress as `0x${string}`, budget - ownerBalance],
            });
            await chain.waitForTransactionReceipt({ hash: mintHash });
        }
        const existing = await db
            .select({ id: campaign.id, active: campaign.active })
            .from(campaign)
            .where(eq(campaign.cafeId, cafeId));
        demoCampaignStates = existing;
        if (demoCampaignStates.length > 0)
            await db
                .update(campaign)
                .set({ active: false })
                .where(
                    inArray(
                        campaign.id,
                        demoCampaignStates.map((row) => row.id),
                    ),
                );
        const created = await createCampaignService(ownerId, cafeId, {
            name: `Live campaign ${suffix}`,
            windowStart: new Date(Date.now() - 60_000),
            windowEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            voucherPayout: payout,
            maxVouchers: cap,
        });
        expect(
            created.ok,
            created.ok ? undefined : JSON.stringify(created.error),
        ).toBe(true);
        if (!created.ok) throw new Error("campaign creation failed");
        campaignId = created.data.campaignId;
        await drainRelayerAndIndexer();
    });

    it("creates, funds, and publishes exact campaign terms", async () => {
        const [created] = await db
            .select()
            .from(campaign)
            .where(eq(campaign.id, campaignId));
        expect(created?.chainCampaignId).toEqual(expect.any(Number));
        chainCampaignId = created?.chainCampaignId ?? 0;
        const funded = await fundCampaignService(
            ownerId,
            cafeId,
            campaignId,
            budget,
        );
        expect(
            funded.ok,
            funded.ok ? undefined : JSON.stringify(funded.error),
        ).toBe(true);
        await drainRelayerAndIndexer();
        const published = await publishCampaignService(
            ownerId,
            cafeId,
            campaignId,
        );
        expect(
            published.ok,
            published.ok ? undefined : JSON.stringify(published.error),
        ).toBe(true);
        await drainRelayerAndIndexer();
        const [projection] = await db
            .select()
            .from(projectionCampaign)
            .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));
        expect(projection).toMatchObject({
            status: "published",
            voucherPayout: payout,
            maxVouchers: cap,
            budget,
        });
    });

    it("projects a qualifying voucher only after VoucherUnlocked is confirmed", async () => {
        firstOrderId = await createPurchase("first");
        await recoverStuckJobs();
        await runRelayerOnce();
        await runIndexerOnce();
        expect(
            await db
                .select({ id: consumerVoucher.id })
                .from(consumerVoucher)
                .where(eq(consumerVoucher.campaignId, campaignId)),
        ).toHaveLength(0);
        await runRelayerOnce();
        await runIndexerOnce();
        const [voucher] = await db
            .select({ id: consumerVoucher.id })
            .from(consumerVoucher)
            .where(eq(consumerVoucher.campaignId, campaignId));
        expect(voucher).toBeDefined();
        voucherId = voucher?.id ?? "";
        const [projection] = await db
            .select({ unlockedCount: projectionCampaign.unlockedCount })
            .from(projectionCampaign)
            .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));
        expect(projection?.unlockedCount).toBe(1);
    });

    it("converges a repeated same-consumer café purchase without a second voucher", async () => {
        secondOrderId = await createPurchase("second");
        await drainRelayerAndIndexer();
        expect(
            await db
                .select({ id: consumerVoucher.id })
                .from(consumerVoucher)
                .where(eq(consumerVoucher.campaignId, campaignId)),
        ).toHaveLength(1);
        const [projection] = await db
            .select({ unlockedCount: projectionCampaign.unlockedCount })
            .from(projectionCampaign)
            .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));
        expect(projection?.unlockedCount).toBe(1);
        const unlockJobs = await db
            .select({ status: relayerJob.status })
            .from(relayerJob)
            .where(
                like(
                    relayerJob.idempotencyKey,
                    `voucher_unlock:${chainCampaignId}:${consumerAddress.toLowerCase()}%`,
                ),
            );
        expect(unlockJobs).toHaveLength(1);
    });

    it("pays the café owner exactly one voucherPayout on redemption", async () => {
        const before = await chain.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [ownerAddress as `0x${string}`],
        });
        const requested = await requestVoucherRedemptionService(
            consumerId,
            cafeId,
            { voucherId },
        );
        expect(
            requested.ok,
            requested.ok ? undefined : JSON.stringify(requested.error),
        ).toBe(true);
        if (!requested.ok) throw new Error("voucher redemption request failed");
        redemptionRequestId = requested.data.id;
        const approved = await decideVoucherRedemptionService(
            ownerId,
            cafeId,
            redemptionRequestId,
            { decision: "approved" },
        );
        expect(
            approved.ok,
            approved.ok ? undefined : JSON.stringify(approved.error),
        ).toBe(true);
        await drainRelayerAndIndexer();
        const after = await chain.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [ownerAddress as `0x${string}`],
        });
        const [projected] = await db
            .select()
            .from(projectionCampaign)
            .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));
        expect(after - before).toBe(payout);
        expect(projected?.redeemedCount).toBe(1);
        expect(projected?.budget).toBe(budget - payout);
    });

    afterAll(async () => {
        if (!live) return;
        const orderIds = [firstOrderId, secondOrderId].filter(Boolean);
        if (orderIds.length > 0) {
            await db
                .delete(chainPurchaseEffect)
                .where(inArray(chainPurchaseEffect.purchaseOrderId, orderIds));
            await db
                .delete(consumerTransaction)
                .where(inArray(consumerTransaction.purchaseOrderId, orderIds));
            await db
                .delete(consumptionProof)
                .where(inArray(consumptionProof.purchaseOrderId, orderIds));
            await db
                .delete(relayerJob)
                .where(inArray(relayerJob.orderId, orderIds));
            await db
                .delete(purchaseOrder)
                .where(inArray(purchaseOrder.id, orderIds));
        }
        if (redemptionRequestId)
            await db
                .delete(relayerJob)
                .where(
                    sql`${relayerJob.payload}->>'redemptionRequestId' = ${redemptionRequestId}`,
                );
        if (voucherId)
            await db
                .delete(redemptionRequest)
                .where(eq(redemptionRequest.voucherId, voucherId));
        if (campaignId) {
            await db
                .delete(consumerVoucher)
                .where(eq(consumerVoucher.campaignId, campaignId));
            await db
                .delete(relayerJob)
                .where(
                    sql`${relayerJob.payload}->>'campaignId' = ${campaignId} OR ${relayerJob.payload}->>'chainCampaignId' = ${chainCampaignId}`,
                );
            if (chainCampaignId > 0)
                await db
                    .delete(projectionCampaign)
                    .where(
                        eq(projectionCampaign.chainCampaignId, chainCampaignId),
                    );
            await db.delete(campaign).where(eq(campaign.id, campaignId));
        }
        for (const state of demoCampaignStates) {
            await db
                .update(campaign)
                .set({ active: state.active })
                .where(eq(campaign.id, state.id));
        }
    });
});
