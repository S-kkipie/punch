import { parseEventLogs } from "viem";
import { linkChainCampaign } from "@/core/campaign/server/repository/campaign-repository";
import { abis } from "@/core/chain/abis";
import type { JobHandler } from "./types";

const MAX_SQL_INT = 2_147_483_647;

type Payload = { campaignId: string; chainCafeId: number };

function payloadOf(job: { payload: unknown }): Payload {
    const value = job.payload as Partial<Payload>;
    if (
        typeof value?.campaignId !== "string" ||
        typeof value?.chainCafeId !== "number"
    ) {
        throw new Error("invalid payload");
    }
    return value as Payload;
}

export const campaignCreateHandler: JobHandler = {
    kind: "campaign_create",
    signer: () => ({ kind: "ops" }),
    // createCampaign has no on-chain duplicate guard. Persist the signed
    // transaction before broadcasting so retries never create a second campaign.
    idempotentOnChain: false,
    async call(job, ctx) {
        const { chainCafeId } = payloadOf(job);
        return {
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "createCampaign",
            args: [BigInt(chainCafeId)],
        };
    },
    onConfirmed(job, receipt) {
        const { campaignId } = payloadOf(job);
        // The event carries no Postgres id, but this receipt belongs to this
        // job, so the correlation is exact. Reading nextCampaignId before
        // sending would race with a concurrent create.
        const [event] = parseEventLogs({
            abi: abis.campaignEscrow,
            logs: receipt.logs,
            eventName: "CampaignCreated",
            strict: true,
        });
        if (!event)
            throw new Error("createCampaign receipt has no CampaignCreated");
        const chainCampaignId = (event.args as { campaignId: bigint })
            .campaignId;
        if (chainCampaignId > BigInt(MAX_SQL_INT)) {
            throw new Error("chain campaign id overflows SQL integer");
        }
        return async (tx) => {
            await linkChainCampaign(tx, campaignId, Number(chainCampaignId));
        };
    },
};
