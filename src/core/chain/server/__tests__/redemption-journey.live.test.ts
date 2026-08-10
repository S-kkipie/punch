import { eq } from "drizzle-orm";
import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { beforeAll, describe, expect, it } from "vitest";
import { env } from "@/config/env";
import { ServerConfig } from "@/config/server-config";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import { runRelayerOnce } from "@/core/chain/server/relayer/relayer";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import { approveRedemptionAndEnqueueJob } from "@/core/consumption/server/repository/redemption-requests";
import { createPurchaseProofService } from "@/core/consumption/server/services/create-purchase-proof-service";
import { requestPunchRedemptionService } from "@/core/consumption/server/services/request-punch-redemption-service";
import { confirmQuoteService } from "@/core/purchase/server/services/confirm-quote-service";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCafePayout } from "@/server/drizzle/schemas/chain-schema";
import { redemptionRequest } from "@/server/drizzle/schemas/consumption-schema";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";

const live =
    process.env.PUNCH_RUN_INTEGRATION === "1" &&
    process.env.PUNCH_RUN_LIVE_CHAIN === "1";
const describeLive = describe.skipIf(!live);
const rpcUrl = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";

let consumerId = "";
let consumerWallet = "";
let cafeId = "";
let cafeChainId = 0;
let emissionProductId = "";
let rewardProductId = "";
let rewardChainProductId!: number;
let ownerWallet = "";
let requestId = "";
let vaultBalanceAfter = 0n;
let payoutAfter = 0n;

const chain = createPublicClient({ chain: foundry, transport: http(rpcUrl) });

async function findFixture() {
    const [consumer] = await db
        .select({ id: user.id, walletAddress: user.walletAddress })
        .from(user)
        .where(eq(user.email, "demo-consumer@punch.pe"));
    const [targetCafe] = await db
        .select({ id: cafe.id, chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .where(eq(cafe.slug, "esquina-sur"));
    const products = targetCafe
        ? await db
              .select({
                  id: cafeProduct.id,
                  type: cafeProduct.type,
                  chainProductId: cafeProduct.chainProductId,
              })
              .from(cafeProduct)
              .where(eq(cafeProduct.cafeId, targetCafe.id))
        : [];
    const [emission] = products.filter(
        (product) => product.type === "emission",
    );
    const [reward] = products.filter((product) => product.type === "reward");
    const [owner] = await db
        .select({
            walletIndex: user.walletIndex,
            walletAddress: user.walletAddress,
        })
        .from(user)
        .where(eq(user.email, "esquinasur@punch.pe"));
    if (
        !consumer?.walletAddress ||
        !targetCafe?.chainCafeId ||
        !emission ||
        !reward ||
        owner?.walletIndex === null ||
        owner?.walletIndex === undefined ||
        !owner.walletAddress ||
        reward.chainProductId === null
    ) {
        throw new Error("live redemption journey seed precondition is missing");
    }
    consumerId = consumer.id;
    consumerWallet = consumer.walletAddress;
    cafeId = targetCafe.id;
    cafeChainId = targetCafe.chainCafeId;
    emissionProductId = emission.id;
    rewardProductId = reward.id;
    rewardChainProductId = reward.chainProductId;
    ownerWallet = owner.walletAddress;
}

describeLive("live redemption journey", () => {
    beforeAll(async () => {
        if (ServerConfig.consumerChainMode !== "local") {
            throw new Error(
                `live redemption journey requires CONSUMER_CHAIN_MODE=local; got '${ServerConfig.consumerChainMode}'`,
            );
        }
        await findFixture();
        await runIndexerOnce();
    });

    it("redeemer is wired to the relayer wallet", async () => {
        const redeemer = await chain.readContract({
            address: getAddresses().punchVault,
            abi: abis.punchVault,
            functionName: "redeemer",
        });
        const relayer = deriveUserAccount(env.RELAYER_WALLET_INDEX).address;
        expect((redeemer as string).toLowerCase()).toBe(relayer.toLowerCase());
    });

    it("approving a redemption burns 12 and pays the host on chain", async () => {
        let before = 0n;
        const [payoutBefore] = await chain
            .readContract({
                address: getAddresses().mockPEN,
                abi: abis.mockPEN,
                functionName: "balanceOf",
                args: [ownerWallet as `0x${string}`],
            })
            .then((balance) => [balance as bigint]);

        const issued = await createPurchaseProofService(
            (
                await db
                    .select({ id: user.id })
                    .from(user)
                    .where(eq(user.email, "esquinasur@punch.pe"))
            )[0].id,
            cafeId,
            {
                productId: emissionProductId,
                yapeRef: `LIVE-REDEMPTION-${crypto.randomUUID()}`,
            },
        );
        expect(issued.ok).toBe(true);
        if (!issued.ok) throw new Error("purchase issuance failed");
        const confirmed = await confirmQuoteService(consumerId, issued.data.id);
        expect(confirmed.ok).toBe(true);
        await runRelayerOnce();
        await runIndexerOnce();
        before = (await chain.readContract({
            address: getAddresses().punchVault,
            abi: abis.punchVault,
            functionName: "balanceOf",
            args: [consumerWallet as `0x${string}`],
        })) as bigint;
        if (before < 12n) {
            throw new Error(
                `live redemption journey requires seeded history; run pnpm chain:seed-history first (chain balance: ${before.toString()})`,
            );
        }

        const requested = await requestPunchRedemptionService(
            consumerId,
            cafeId,
            {
                productId: rewardProductId,
            },
        );
        if (!requested.ok)
            throw new Error(
                `redemption request failed: ${JSON.stringify(requested.error)}`,
            );
        expect(requested.ok).toBe(true);
        requestId = requested.data.id;
        await approveRedemptionAndEnqueueJob(requestId, consumerId, {
            userWallet: consumerWallet,
            chainCafeId: cafeChainId,
            chainProductId: rewardChainProductId,
        });
        await runRelayerOnce();
        await runIndexerOnce();

        const vaultBalance = await chain.readContract({
            address: getAddresses().punchVault,
            abi: abis.punchVault,
            functionName: "balanceOf",
            args: [consumerWallet as `0x${string}`],
        });
        const payout = await chain.readContract({
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [ownerWallet as `0x${string}`],
        });
        expect(vaultBalance).toBe(before - 12n);
        expect(payout).toBe((payoutBefore as bigint) + 3_600_000n);
        vaultBalanceAfter = vaultBalance as bigint;
        payoutAfter = payout as bigint;

        const [request] = await db
            .select({ status: redemptionRequest.status })
            .from(redemptionRequest)
            .where(eq(redemptionRequest.id, requestId));
        expect(request?.status).toBe("confirmed");
        const [projection] = await db
            .select({ totalCentimos: projectionCafePayout.totalCentimos })
            .from(projectionCafePayout)
            .where(eq(projectionCafePayout.cafeId, cafeId));
        expect(projection?.totalCentimos).toBe(360);
    });

    it("double-approving does not double-burn", async () => {
        await approveRedemptionAndEnqueueJob(requestId, consumerId, {
            userWallet: consumerWallet,
            chainCafeId: cafeChainId,
            chainProductId: rewardChainProductId,
        });
        await runRelayerOnce();
        await runRelayerOnce();

        const vaultBalance = await chain.readContract({
            address: getAddresses().punchVault,
            abi: abis.punchVault,
            functionName: "balanceOf",
            args: [consumerWallet as `0x${string}`],
        });
        const payout = await chain.readContract({
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [ownerWallet as `0x${string}`],
        });
        expect(vaultBalance).toBe(vaultBalanceAfter);
        expect(payout).toBe(payoutAfter);
        const jobs = await db
            .select({ id: relayerJob.id })
            .from(relayerJob)
            .where(eq(relayerJob.redemptionRequestId, requestId));
        expect(jobs).toHaveLength(1);
    });
});
