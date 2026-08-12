import "server-only";

import type { Address } from "viem";
import { calculateCampaignFunding } from "@/core/campaign/domain/funding";
import type { CampaignLifecycle } from "@/core/campaign/domain/types";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";
import { findUserWallet } from "@/core/purchase/server/repository/purchase-repository";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { listCafeCampaigns } from "../repository/campaign-repository";

export type CafeCampaignList = {
    campaigns: CafeCampaign[];
    /**
     * mPEN que la billetera del dueño tiene ahora. Financiar una campaña sale
     * de aquí, así que la pantalla necesita el número para no ofrecer un
     * financiamiento que la cadena va a rechazar.
     */
    walletBalance: bigint;
};

export type CafeCampaign = {
    id: string;
    cafeId: string;
    name: string;
    windowStart: Date;
    windowEnd: Date;
    voucherPayout: bigint;
    maxVouchers: number;
    lifecycle: CampaignLifecycle;
    required: bigint;
    funded: bigint;
    missing: bigint;
    canPublish: boolean;
};

export type ListCafeCampaignsDeps = {
    readMpenBalance: (address: Address) => Promise<bigint>;
};

const defaults: ListCafeCampaignsDeps = {
    readMpenBalance: async (address) =>
        createChainPublicClient().readContract({
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [address],
        }),
};

export async function listCafeCampaignsService(
    userId: string,
    cafeId: string,
    deps: ListCafeCampaignsDeps = defaults,
): AsyncAppResult<CafeCampaignList> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;

        const rows = await listCafeCampaigns(cafeId);
        const campaigns: CafeCampaign[] = [];
        for (const row of rows) {
            if (
                row.campaign.voucherPayout === null ||
                row.campaign.maxVouchers === null
            ) {
                return err(AppErrors.conflict({ targets: ["campaignId"] }));
            }
            const funding = calculateCampaignFunding(
                {
                    voucherPayout: row.campaign.voucherPayout,
                    maxVouchers: row.campaign.maxVouchers,
                    chainCampaignId: row.campaign.chainCampaignId,
                },
                row.projection,
            );
            campaigns.push({
                id: row.campaign.id,
                cafeId: row.campaign.cafeId,
                name: row.campaign.name,
                windowStart: row.campaign.windowStart,
                windowEnd: row.campaign.windowEnd,
                voucherPayout: row.campaign.voucherPayout,
                maxVouchers: row.campaign.maxVouchers,
                ...funding,
            });
        }
        const wallet = await findUserWallet(userId);
        const walletBalance = wallet?.walletAddress
            ? await deps.readMpenBalance(wallet.walletAddress as Address)
            : 0n;
        return ok({ campaigns, walletBalance });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
