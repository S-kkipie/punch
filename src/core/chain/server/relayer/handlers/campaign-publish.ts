import { abis } from "@/core/chain/abis";
import type { JobFailure, JobHandler } from "./types";

type Payload = {
    campaignId: string;
    chainCampaignId: number;
    voucherPayout: string;
    maxVouchers: number;
    windowEnd: string;
};

function payloadOf(job: { payload: unknown }): Payload {
    const value = job.payload as Partial<Payload>;
    if (
        typeof value?.campaignId !== "string" ||
        typeof value?.chainCampaignId !== "number" ||
        typeof value?.voucherPayout !== "string" ||
        typeof value?.maxVouchers !== "number" ||
        typeof value?.windowEnd !== "string"
    ) {
        throw new Error("invalid payload");
    }
    return value as Payload;
}

function publishTerms(payload: Payload) {
    const windowEnd = new Date(payload.windowEnd);
    return {
        voucherPayout: BigInt(payload.voucherPayout),
        maxVouchers: BigInt(payload.maxVouchers),
        expiry: BigInt(Math.floor(windowEnd.getTime() / 1000)),
    };
}

export const campaignPublishHandler: JobHandler = {
    kind: "campaign_publish",
    signer: () => ({ kind: "ops" }),
    async call(job, ctx) {
        const payload = payloadOf(job);
        const terms = publishTerms(payload);
        return {
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "publishCampaign",
            args: [
                BigInt(payload.chainCampaignId),
                terms.voucherPayout,
                terms.maxVouchers,
                terms.expiry,
            ],
        };
    },
    async preflight(job, ctx): Promise<JobFailure | null> {
        const payload = payloadOf(job);
        const terms = publishTerms(payload);
        const live = (await ctx.pub.readContract({
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "campaigns",
            args: [BigInt(payload.chainCampaignId)],
        })) as { budget: bigint };
        const required = terms.voucherPayout * terms.maxVouchers;
        if (live.budget < required) {
            return {
                code: "insufficient_budget",
                message:
                    "campaign escrow budget is below the promised voucher payout",
            };
        }
        return null;
    },
};
