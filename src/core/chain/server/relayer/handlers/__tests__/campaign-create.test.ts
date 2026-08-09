import { encodeEventTopics } from "viem";
import { describe, expect, it, vi } from "vitest";
import { abis } from "@/core/chain/abis";

const { linkChainCampaign } = vi.hoisted(() => ({
    linkChainCampaign: vi.fn(),
}));

vi.mock("@/core/campaign/server/repository/campaign-repository", () => ({
    linkChainCampaign,
}));

import { campaignCreateHandler } from "../campaign-create";

const job = {
    id: "job-1",
    kind: "campaign_create" as const,
    payload: { campaignId: "camp-1", chainCafeId: 7 },
};

describe("campaign_create handler", () => {
    it("signs with the ops key", () => {
        expect(campaignCreateHandler.signer(job as never)).toEqual({
            kind: "ops",
        });
    });

    it("declares that the chain call is non-idempotent", () => {
        expect(campaignCreateHandler.idempotentOnChain).toBe(false);
    });

    it("calls createCampaign with the chain cafe id", async () => {
        const call = await campaignCreateHandler.call(
            job as never,
            {
                addresses: {
                    campaignEscrow:
                        "0x1111111111111111111111111111111111111111",
                },
            } as never,
        );
        expect(call.functionName).toBe("createCampaign");
        expect(call.args).toEqual([7n]);
    });

    it("reads the new campaign id from its own receipt", async () => {
        const topics = encodeEventTopics({
            abi: abis.campaignEscrow,
            eventName: "CampaignCreated",
            args: { campaignId: 42n, sourceCafeId: 7n },
        });
        const receipt = {
            logs: [
                {
                    address: "0x1111111111111111111111111111111111111111",
                    topics,
                    data: "0x",
                },
            ],
        };

        const sideEffect = campaignCreateHandler.onConfirmed?.(
            job as never,
            receipt as never,
        );
        await sideEffect?.({} as never, job as never);
        expect(linkChainCampaign).toHaveBeenCalledWith({}, "camp-1", 42);
    });
});
