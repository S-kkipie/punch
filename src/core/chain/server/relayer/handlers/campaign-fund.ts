import { abis } from "@/core/chain/abis";
import { enqueueJob } from "@/core/chain/server/relayer/job-repository";
import type { JobHandler } from "./types";

type Payload = {
    campaignId: string;
    chainCampaignId: number;
    amount: string;
    walletIndex: number;
    fundingId: string;
};

function payloadOf(job: { payload: unknown }): Payload {
    const value = job.payload as Partial<Payload>;
    if (
        typeof value?.campaignId !== "string" ||
        typeof value?.chainCampaignId !== "number" ||
        typeof value?.amount !== "string" ||
        typeof value?.walletIndex !== "number" ||
        typeof value?.fundingId !== "string"
    ) {
        throw new Error("invalid payload");
    }
    return value as Payload;
}

export const campaignFundApproveHandler: JobHandler = {
    kind: "campaign_fund_approve",
    signer: (job) => ({
        kind: "wallet",
        walletIndex: payloadOf(job).walletIndex,
    }),
    async call(job, ctx) {
        const { amount } = payloadOf(job);
        return {
            address: ctx.addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "approve",
            args: [ctx.addresses.campaignEscrow, BigInt(amount)],
        };
    },
    onConfirmed(job) {
        const payload = payloadOf(job);
        return async (tx) => {
            await enqueueJob(tx, {
                kind: "campaign_fund",
                idempotencyKey: `campaign_fund:${payload.campaignId}:${payload.fundingId}`,
                payload,
            });
        };
    },
};

export const campaignFundHandler: JobHandler = {
    kind: "campaign_fund",
    signer: (job) => ({
        kind: "wallet",
        walletIndex: payloadOf(job).walletIndex,
    }),
    // fundCampaign transfers mPEN and has no on-chain duplicate guard.
    idempotentOnChain: false,
    async call(job, ctx) {
        const { chainCampaignId, amount } = payloadOf(job);
        return {
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "fundCampaign",
            args: [BigInt(chainCampaignId), BigInt(amount)],
        };
    },
};
