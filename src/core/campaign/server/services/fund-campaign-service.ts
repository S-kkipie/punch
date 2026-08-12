import "server-only";

import type { Address } from "viem";
import { findCampaignWithProjection } from "@/core/campaign/server/repository/campaign-repository";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";
import { enqueueJob } from "@/core/chain/server/relayer/job-repository";
import { findUserWallet } from "@/core/purchase/server/repository/purchase-repository";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";

export type FundCampaignDeps = {
    readMpenBalance: (address: Address) => Promise<bigint>;
};

const defaults: FundCampaignDeps = {
    readMpenBalance: async (address) =>
        createChainPublicClient().readContract({
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [address],
        }),
};

export async function fundCampaignService(
    userId: string,
    cafeId: string,
    campaignId: string,
    amount: bigint,
    deps: FundCampaignDeps = defaults,
): AsyncAppResult<{ fundingId: string }> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;
        if (amount <= 0n) return err(AppErrors.invalidBody());

        const row = await findCampaignWithProjection(campaignId);
        if (!row || row.campaign.cafeId !== cafeId) {
            return err(AppErrors.notFound({ targets: ["campaignId"] }));
        }
        if (
            row.campaign.chainCampaignId === null ||
            row.projection?.status !== "draft"
        ) {
            return err(AppErrors.conflict({ targets: ["campaignId"] }));
        }

        const wallet = await findUserWallet(userId);
        if (wallet?.walletIndex === null || wallet?.walletIndex === undefined) {
            return err(AppErrors.conflict({ targets: ["walletIndex"] }));
        }
        if (!wallet.walletAddress) {
            return err(AppErrors.conflict({ targets: ["walletAddress"] }));
        }

        // `fundCampaign` hace `transferFrom` desde esta billetera: sin saldo,
        // la transacción revierte en la cadena, mucho después del clic y sin
        // que nadie se entere. Se rechaza antes de encolar nada.
        const balance = await deps.readMpenBalance(
            wallet.walletAddress as Address,
        );
        if (balance < amount) {
            return err(AppErrors.conflict({ targets: ["balance"] }));
        }

        const fundingId = crypto.randomUUID();
        await db.transaction(async (tx) => {
            await enqueueJob(tx, {
                kind: "campaign_fund_approve",
                idempotencyKey: `campaign_fund_approve:${campaignId}:${fundingId}`,
                payload: {
                    campaignId,
                    chainCampaignId: row.campaign.chainCampaignId,
                    amount: amount.toString(),
                    walletIndex: wallet.walletIndex,
                    fundingId,
                },
            });
        });

        return ok({ fundingId });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
