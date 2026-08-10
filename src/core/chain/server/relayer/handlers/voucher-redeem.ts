import { abis } from "@/core/chain/abis";
import type { JobHandler } from "./types";

type Payload = {
    chainCampaignId: number | string;
    userAddress: string;
    redemptionRequestId: string;
    voucherId: string;
};

function payloadOf(job: { payload: unknown }): Payload {
    if (!job.payload || typeof job.payload !== "object") {
        throw new Error("invalid payload");
    }
    const value = job.payload as Partial<Payload>;
    const validChainId =
        (typeof value.chainCampaignId === "number" &&
            Number.isSafeInteger(value.chainCampaignId) &&
            value.chainCampaignId >= 0) ||
        (typeof value.chainCampaignId === "string" &&
            /^\d+$/.test(value.chainCampaignId));
    if (
        !validChainId ||
        typeof value.userAddress !== "string" ||
        typeof value.redemptionRequestId !== "string" ||
        typeof value.voucherId !== "string"
    ) {
        throw new Error("invalid payload");
    }
    return value as Payload;
}

export const voucherRedeemHandler: JobHandler = {
    kind: "voucher_redeem",
    signer: () => ({ kind: "relayer" }),
    async call(job, ctx) {
        const payload = payloadOf(job);
        return {
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "redeemVoucher",
            args: [BigInt(payload.chainCampaignId), payload.userAddress],
        };
    },
    idempotentCodes: new Set(["voucher_already_redeemed"]),
};
