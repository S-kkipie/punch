import { describe, expect, it, vi } from "vitest";

import { campaignPublishHandler } from "../campaign-publish";

const job = {
    id: "job-1",
    kind: "campaign_publish" as const,
    payload: {
        campaignId: "camp-1",
        chainCampaignId: 3,
        voucherPayout: "50",
        maxVouchers: 10,
        windowEnd: "2030-01-02T03:04:05.000Z",
    },
};

const addresses = {
    campaignEscrow: "0x1111111111111111111111111111111111111111" as const,
};

describe("campaign_publish handler", () => {
    it("signs with the ops key", () => {
        expect(campaignPublishHandler.signer(job as never)).toEqual({
            kind: "ops",
        });
    });

    it("calls publishCampaign with exact campaign values and expiry", async () => {
        const call = await campaignPublishHandler.call(
            job as never,
            {
                addresses,
            } as never,
        );

        expect(call.functionName).toBe("publishCampaign");
        expect(call.args).toEqual([3n, 50n, 10n, 1893553445n]);
    });

    it("rejects a live escrow budget below promised vouchers", async () => {
        const readContract = vi.fn().mockResolvedValue({
            budget: 499n,
            voucherPayout: 50n,
            maxVouchers: 10n,
        });

        const failure = await campaignPublishHandler.preflight?.(
            job as never,
            {
                addresses,
                pub: { readContract },
            } as never,
        );

        expect(readContract).toHaveBeenCalledWith({
            address: addresses.campaignEscrow,
            abi: expect.any(Array),
            functionName: "campaigns",
            args: [3n],
        });
        expect(failure).toMatchObject({ code: "insufficient_budget" });
    });

    it("rejects payload terms that exceed a zero-term live draft budget", async () => {
        const failure = await campaignPublishHandler.preflight?.(
            job as never,
            {
                addresses,
                pub: {
                    readContract: vi.fn().mockResolvedValue({
                        budget: 499n,
                        voucherPayout: 0n,
                        maxVouchers: 0n,
                    }),
                },
            } as never,
        );

        expect(failure).toMatchObject({ code: "insufficient_budget" });
    });

    it("allows a live escrow budget that covers every voucher", async () => {
        const failure = await campaignPublishHandler.preflight?.(
            {
                ...job,
                payload: { ...job.payload },
            } as never,
            {
                addresses,
                pub: {
                    readContract: vi.fn().mockResolvedValue({
                        budget: 500n,
                        voucherPayout: 50n,
                        maxVouchers: 10n,
                    }),
                },
            } as never,
        );

        expect(failure).toBeNull();
    });
});
