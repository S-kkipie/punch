import { and, eq, inArray, isNotNull } from "drizzle-orm";
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
import { currentEpoch } from "@/core/chain/server/network-fund/epoch";
import {
    closeEpoch,
    fundCurrentEpoch,
} from "@/core/chain/server/network-fund/epoch-ops";
import {
    recoverStuckJobs,
    runRelayerOnce,
} from "@/core/chain/server/relayer/relayer";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { createPurchaseProofService } from "@/core/consumption/server/services/create-purchase-proof-service";
import { confirmQuoteService } from "@/core/purchase/server/services/confirm-quote-service";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import {
    cafe,
    cafeMember,
    cafeProduct,
} from "@/server/drizzle/schemas/cafe-schema";
import {
    consumerTransaction,
    consumptionProof,
} from "@/server/drizzle/schemas/consumption-schema";
import {
    campaign,
    chainPurchaseEffect,
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
const budget = payout;
const suffix = crypto.randomUUID();
const yapeRef = `LIVE-NETWORK-FUND-${suffix}`;
const epoch = currentEpoch();
const deployer = mnemonicToAccount(
    "test test test test test test test test test test test junk",
    { addressIndex: 0 },
);
const rpcUrl = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
const chain = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
const wallet = createWalletClient({
    account: deployer,
    chain: foundry,
    transport: http(rpcUrl),
});
const addresses = getAddresses();

let ownerId = "";
let ownerAddress = "";
let consumerId = "";
let consumerAddress = "";
let baristaId = "";
let cafeId = "";
let chainCafeId = 0;
let productId = "";
let campaignId = "";
let chainCampaignId = 0;
let orderId = "";
let reuseFinalizedEpoch = false;
let demoCampaignStates: { id: string; active: boolean }[] = [];

async function drainRelayerAndIndexer() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
        await recoverStuckJobs();
        await runRelayerOnce();
        await runIndexerOnce();
    }
}

async function listChainCafeIds(): Promise<number[]> {
    const rows = await db
        .select({ chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .where(isNotNull(cafe.chainCafeId));
    return rows.flatMap(({ chainCafeId: id }) => (id === null ? [] : [id]));
}

async function prepareFixture() {
    const consumerUserId = `live-network-fund-consumer-${suffix}`;
    await db.insert(user).values({
        id: consumerUserId,
        name: "Live Network Fund Consumer",
        email: `live-network-fund-${suffix}@punch.pe`,
    });
    const consumerWallet = await assignWallet(consumerUserId);
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
        .select({ id: cafe.id, chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .where(eq(cafe.slug, "esquina-sur"));
    if (
        !consumerWallet.address ||
        !owner?.walletAddress ||
        !barista ||
        !targetCafe?.chainCafeId
    ) {
        throw new Error("network fund journey seed precondition is missing");
    }
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
    if (!product) throw new Error("network fund journey product is missing");

    ownerId = owner.id;
    ownerAddress = owner.walletAddress;
    consumerId = consumerUserId;
    consumerAddress = consumerWallet.address;
    baristaId = barista.id;
    cafeId = targetCafe.id;
    chainCafeId = targetCafe.chainCafeId;
    productId = product.id;
}

describeLive("live network fund journey", () => {
    beforeAll(async () => {
        if (process.env.CONSUMER_CHAIN_MODE !== "local") {
            throw new Error(
                "network fund live journey requires CONSUMER_CHAIN_MODE=local",
            );
        }
        const existingEpoch = await chain.readContract({
            address: addresses.networkFund,
            abi: abis.networkFund,
            functionName: "getEpoch",
            args: [BigInt(epoch)],
        });
        if (existingEpoch.finalized) {
            const [owner] = await db
                .select({ walletAddress: user.walletAddress })
                .from(user)
                .innerJoin(cafeMember, eq(cafeMember.userId, user.id))
                .where(
                    and(
                        eq(cafeMember.role, "owner"),
                        eq(user.email, "esquinasur@punch.pe"),
                    ),
                );
            const [targetCafe] = await db
                .select({ id: cafe.id, chainCafeId: cafe.chainCafeId })
                .from(cafe)
                .where(eq(cafe.slug, "esquina-sur"));
            if (!owner?.walletAddress || !targetCafe?.chainCafeId) {
                throw new Error("finalized network fund fixture is missing");
            }
            ownerAddress = owner.walletAddress;
            cafeId = targetCafe.id;
            chainCafeId = targetCafe.chainCafeId;
            reuseFinalizedEpoch = true;
            return;
        }

        await prepareFixture();
        const ownerBalance = await chain.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [ownerAddress as `0x${string}`],
        });
        if (ownerBalance < budget) {
            const mintHash = await wallet.writeContract({
                address: addresses.mockPEN,
                abi: abis.mockPEN,
                functionName: "mint",
                args: [ownerAddress as `0x${string}`, budget - ownerBalance],
            });
            await chain.waitForTransactionReceipt({ hash: mintHash });
        }

        demoCampaignStates = await db
            .select({ id: campaign.id, active: campaign.active })
            .from(campaign)
            .where(eq(campaign.cafeId, cafeId));
        if (demoCampaignStates.length > 0) {
            await db
                .update(campaign)
                .set({ active: false })
                .where(
                    inArray(
                        campaign.id,
                        demoCampaignStates.map((row) => row.id),
                    ),
                );
        }

        const created = await createCampaignService(ownerId, cafeId, {
            name: `Live network fund campaign ${suffix}`,
            windowStart: new Date(Date.now() - 60_000),
            windowEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            voucherPayout: payout,
            maxVouchers: 1,
        });
        expect(
            created.ok,
            created.ok ? undefined : JSON.stringify(created.error),
        ).toBe(true);
        if (!created.ok)
            throw new Error("network fund campaign creation failed");
        campaignId = created.data.campaignId;
        await drainRelayerAndIndexer();

        const [createdCampaign] = await db
            .select({ chainCampaignId: campaign.chainCampaignId })
            .from(campaign)
            .where(eq(campaign.id, campaignId));
        if (!createdCampaign?.chainCampaignId) {
            throw new Error("network fund campaign chain link is missing");
        }
        chainCampaignId = createdCampaign.chainCampaignId;

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
    });

    it("funds and closes the current epoch from a verified purchase referral", async () => {
        const epochId = BigInt(epoch);
        if (reuseFinalizedEpoch) {
            const finalized = await chain.readContract({
                address: addresses.networkFund,
                abi: abis.networkFund,
                functionName: "getEpoch",
                args: [epochId],
            });
            const referrals = await chain.readContract({
                address: addresses.networkFund,
                abi: abis.networkFund,
                functionName: "referrals",
                args: [epochId, BigInt(chainCafeId)],
            });
            expect(finalized.finalized).toBe(true);
            expect(referrals).toBeGreaterThan(0n);
            expect(finalized.originPaid).toBeGreaterThanOrEqual(
                (finalized.originPool * referrals) / finalized.totalReferrals,
            );
            expect(
                await chain.readContract({
                    address: addresses.networkFund,
                    abi: abis.networkFund,
                    functionName: "originClaimed",
                    args: [epochId, BigInt(chainCafeId)],
                }),
            ).toBe(true);
            expect(
                await chain.readContract({
                    address: addresses.networkFund,
                    abi: abis.networkFund,
                    functionName: "pendingOriginCredit",
                    args: [epochId, BigInt(chainCafeId)],
                }),
            ).toBe(0n);
            const closedAgain = await closeEpoch(
                { pub: chain, wallet, addresses, listChainCafeIds },
                epoch,
            );
            expect(closedAgain.claims).toEqual([]);
            return;
        }

        const referralsBefore = await chain.readContract({
            address: addresses.networkFund,
            abi: abis.networkFund,
            functionName: "referrals",
            args: [epochId, BigInt(chainCafeId)],
        });
        const freeBalanceBefore = await chain.readContract({
            address: addresses.networkFund,
            abi: abis.networkFund,
            functionName: "freeBalance",
        });
        expect(freeBalanceBefore).toBeGreaterThan(0n);

        const issued = await createPurchaseProofService(baristaId, cafeId, {
            productId,
            yapeRef,
        });
        expect(
            issued.ok,
            issued.ok ? undefined : JSON.stringify(issued.error),
        ).toBe(true);
        if (!issued.ok) throw new Error("network fund quote issuance failed");
        const confirmed = await confirmQuoteService(consumerId, issued.data.id);
        expect(
            confirmed.ok,
            confirmed.ok ? undefined : JSON.stringify(confirmed.error),
        ).toBe(true);
        if (!confirmed.ok)
            throw new Error("network fund quote confirmation failed");
        orderId = confirmed.data.order.id;
        await drainRelayerAndIndexer();

        const [referralJob] = await db
            .select({ status: relayerJob.status })
            .from(relayerJob)
            .where(
                eq(
                    relayerJob.idempotencyKey,
                    `referral:voucher:${chainCampaignId}:${consumerAddress.toLowerCase()}`,
                ),
            );
        expect(referralJob?.status).toBe("confirmed");
        const referralsAfter = await chain.readContract({
            address: addresses.networkFund,
            abi: abis.networkFund,
            functionName: "referrals",
            args: [epochId, BigInt(chainCafeId)],
        });
        expect(referralsAfter - referralsBefore).toBe(1n);

        const bucketsBefore = await chain.readContract({
            address: addresses.networkFund,
            abi: abis.networkFund,
            functionName: "getEpoch",
            args: [epochId],
        });
        expect(bucketsBefore.finalized).toBe(false);
        const funded = await fundCurrentEpoch(
            { pub: chain, wallet, addresses, listChainCafeIds },
            epoch,
        );
        expect(funded.amount).toBe(freeBalanceBefore);
        const bucketsAfter = await chain.readContract({
            address: addresses.networkFund,
            abi: abis.networkFund,
            functionName: "getEpoch",
            args: [epochId],
        });
        const originDelta = bucketsAfter.originPool - bucketsBefore.originPool;
        const acquisitionDelta =
            bucketsAfter.acquisitionPool - bucketsBefore.acquisitionPool;
        const crawlDelta = bucketsAfter.crawlPool - bucketsBefore.crawlPool;
        const contingencyDelta =
            bucketsAfter.contingencyPool - bucketsBefore.contingencyPool;
        const expectedOrigin = (funded.amount * 4_000n) / 10_000n;
        const expectedAcquisition = (funded.amount * 3_000n) / 10_000n;
        const expectedCrawl = (funded.amount * 2_000n) / 10_000n;
        const expectedBaseContingency = (funded.amount * 1_000n) / 10_000n;
        const roundingRemainder =
            funded.amount -
            expectedOrigin -
            expectedAcquisition -
            expectedCrawl -
            expectedBaseContingency;
        expect(originDelta).toBe(expectedOrigin);
        expect(acquisitionDelta).toBe(expectedAcquisition);
        expect(crawlDelta).toBe(expectedCrawl);
        expect(contingencyDelta).toBe(
            expectedBaseContingency + roundingRemainder,
        );
        expect(
            originDelta + acquisitionDelta + crawlDelta + contingencyDelta,
        ).toBe(funded.amount);

        const ownerBalanceBefore = await chain.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [ownerAddress as `0x${string}`],
        });
        const expectedOriginCredit =
            (bucketsAfter.originPool * referralsAfter) /
            bucketsAfter.totalReferrals;
        const closed = await closeEpoch(
            { pub: chain, wallet, addresses, listChainCafeIds },
            epoch,
        );
        expect(closed.claims).toContainEqual({
            chainCafeId,
            referrals: Number(referralsAfter),
            amount: expectedOriginCredit,
        });
        const ownerBalanceAfter = await chain.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [ownerAddress as `0x${string}`],
        });
        expect(ownerBalanceAfter - ownerBalanceBefore).toBe(
            expectedOriginCredit,
        );
        expect(
            await chain.readContract({
                address: addresses.networkFund,
                abi: abis.networkFund,
                functionName: "originClaimed",
                args: [epochId, BigInt(chainCafeId)],
            }),
        ).toBe(true);

        const closedAgain = await closeEpoch(
            { pub: chain, wallet, addresses, listChainCafeIds },
            epoch,
        );
        expect(closedAgain.claims).toEqual([]);
    });

    afterAll(async () => {
        if (!live) return;
        if (orderId) {
            await db
                .delete(chainPurchaseEffect)
                .where(eq(chainPurchaseEffect.purchaseOrderId, orderId));
            await db
                .delete(consumerTransaction)
                .where(eq(consumerTransaction.purchaseOrderId, orderId));
            await db
                .delete(consumptionProof)
                .where(eq(consumptionProof.purchaseOrderId, orderId));
            await db.delete(relayerJob).where(eq(relayerJob.orderId, orderId));
            await db.delete(purchaseOrder).where(eq(purchaseOrder.id, orderId));
        }
        // The campaign, its projection, voucher, referral job, and fixture
        // consumer stay: their events are on chain and must remain replayable.
        if (campaignId) {
            await db
                .update(campaign)
                .set({ active: false })
                .where(eq(campaign.id, campaignId));
        }
        for (const state of demoCampaignStates) {
            await db
                .update(campaign)
                .set({ active: state.active })
                .where(eq(campaign.id, state.id));
        }
    });
});
