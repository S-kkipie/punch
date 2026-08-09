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

export const campaignPublishHandler: JobHandler = {
    kind: "campaign_publish",
    signer: () => ({ kind: "ops" }),
    async call(job, ctx) {
        const payload = payloadOf(job);
        const windowEnd = new Date(payload.windowEnd);
        return {
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "publishCampaign",
            args: [
                BigInt(payload.chainCampaignId),
                BigInt(payload.voucherPayout),
                BigInt(payload.maxVouchers),
                BigInt(Math.floor(windowEnd.getTime() / 1000)),
            ],
        };
    },
    async preflight(job, ctx): Promise<JobFailure | null> {
        const payload = payloadOf(job);
        const live = (await ctx.pub.readContract({
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "campaigns",
            args: [BigInt(payload.chainCampaignId)],
        })) as { budget: bigint; voucherPayout: bigint; maxVouchers: bigint };
        const required = live.voucherPayout * live.maxVouchers;
        if (live.budget < required) {
            return {
                code: "unknown",
                message:
                    "campaign escrow budget is below the promised voucher payout",
            };
        }
        return null;
    },
};
