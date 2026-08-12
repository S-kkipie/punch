import { abis } from "@/core/chain/abis";
import type { JobFailure, JobHandler } from "./types";

type Payload = {
    campaignId: string;
    chainCampaignId: number;
};

function payloadOf(job: { payload: unknown }): Payload {
    const value = job.payload as Partial<Payload>;
    if (
        typeof value?.campaignId !== "string" ||
        typeof value?.chainCampaignId !== "number"
    ) {
        throw new Error("invalid payload");
    }
    return value as Payload;
}

/**
 * `cancelUnpublishedCampaign` es `onlyOwner`, igual que publicar: la firma la
 * pone operaciones, no la cafetería. El contrato devuelve el presupuesto
 * completo al dueño del café en la misma transacción.
 */
export const campaignCancelHandler: JobHandler = {
    kind: "campaign_cancel",
    signer: () => ({ kind: "ops" }),
    async call(job, ctx) {
        const payload = payloadOf(job);
        return {
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "cancelUnpublishedCampaign",
            args: [BigInt(payload.chainCampaignId)],
        };
    },
    async preflight(job, ctx): Promise<JobFailure | null> {
        const payload = payloadOf(job);
        const live = (await ctx.pub.readContract({
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "campaigns",
            args: [BigInt(payload.chainCampaignId)],
        })) as { status: number };
        // 1 = Draft en CampaignStatus. Una publicada no se puede cancelar
        // nunca, y avisarlo aquí evita una transacción que solo va a revertir.
        if (live.status !== 1) {
            return {
                code: "not_draft",
                message: "campaign is not a draft any more",
            };
        }
        return null;
    },
};
