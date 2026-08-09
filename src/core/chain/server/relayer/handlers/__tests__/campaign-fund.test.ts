import { describe, expect, it } from "vitest";
import {
    campaignFundApproveHandler,
    campaignFundHandler,
} from "../campaign-fund";

const payload = {
    campaignId: "camp-1",
    chainCampaignId: 3,
    amount: "500000000",
    walletIndex: 12,
    fundingId: "fund-1",
};
const job = { id: "job-1", payload };
const ctx = {
    addresses: {
        campaignEscrow: "0x1111111111111111111111111111111111111111",
        mockPEN: "0x2222222222222222222222222222222222222222",
    },
};

describe("campaign funding handlers", () => {
    it("signs with the cafe owner wallet, never with ops", () => {
        expect(campaignFundApproveHandler.signer(job as never)).toEqual({
            kind: "wallet",
            walletIndex: 12,
        });
        expect(campaignFundHandler.signer(job as never)).toEqual({
            kind: "wallet",
            walletIndex: 12,
        });
    });

    it("pins fundCampaign as non-idempotent on chain", () => {
        expect(campaignFundHandler.idempotentOnChain).toBe(false);
        expect(campaignFundApproveHandler.idempotentOnChain).toBeUndefined();
    });

    it("approves the escrow to spend exactly the funded amount", async () => {
        const call = await campaignFundApproveHandler.call(
            job as never,
            ctx as never,
        );
        expect(call.address).toBe(ctx.addresses.mockPEN);
        expect(call.functionName).toBe("approve");
        expect(call.args).toEqual([ctx.addresses.campaignEscrow, 500000000n]);
    });

    it("funds the campaign by chain id", async () => {
        const call = await campaignFundHandler.call(job as never, ctx as never);
        expect(call.address).toBe(ctx.addresses.campaignEscrow);
        expect(call.functionName).toBe("fundCampaign");
        expect(call.args).toEqual([3n, 500000000n]);
    });

    it("chains the fund job when the approval confirms", async () => {
        const enqueued: unknown[] = [];
        const sideEffect = campaignFundApproveHandler.onConfirmed?.(
            job as never,
            { logs: [] } as never,
        );
        await sideEffect?.(
            {
                insert: () => ({
                    values: (v: unknown) => ({
                        onConflictDoNothing: () => ({
                            returning: () => {
                                enqueued.push(v);
                                return Promise.resolve([{}]);
                            },
                        }),
                    }),
                }),
            } as never,
            job as never,
        );
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0]).toMatchObject({
            kind: "campaign_fund",
            idempotencyKey: "campaign_fund:camp-1:fund-1",
            payload,
        });
    });
});
