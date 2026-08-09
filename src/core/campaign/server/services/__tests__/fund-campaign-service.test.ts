import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/server/common/responses";

const {
    requireCafeRole,
    findCampaignWithProjection,
    findUserWallet,
    enqueueJob,
    transaction,
} = vi.hoisted(() => ({
    requireCafeRole: vi.fn(),
    findCampaignWithProjection: vi.fn(),
    findUserWallet: vi.fn(),
    enqueueJob: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole,
}));
vi.mock("@/core/campaign/server/repository/campaign-repository", () => ({
    findCampaignWithProjection,
}));
vi.mock("@/core/purchase/server/repository/purchase-repository", () => ({
    findUserWallet,
}));
vi.mock("@/core/chain/server/relayer/job-repository", () => ({
    enqueueJob,
}));
vi.mock("@/server/drizzle/db", () => ({
    db: { transaction },
}));

import { fundCampaignService } from "../fund-campaign-service";

const validCampaign = {
    campaign: { id: "campaign-1", cafeId: "cafe-1", chainCampaignId: 7 },
    projection: { status: "draft" },
};

beforeEach(() => {
    vi.clearAllMocks();
    requireCafeRole.mockResolvedValue(ok({ role: "owner" }));
    findCampaignWithProjection.mockResolvedValue(validCampaign);
    findUserWallet.mockResolvedValue({ walletIndex: 12 });
    transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({}),
    );
    enqueueJob.mockResolvedValue({ id: "job-1" });
});

describe("fundCampaignService", () => {
    it("rejects a caller who is not the cafe owner without enqueueing", async () => {
        requireCafeRole.mockResolvedValue(
            err({
                type: "ForbiddenError",
                code: "FORBIDDEN",
                status: 403,
            } as never),
        );

        const result = await fundCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
            500n,
        );

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("rejects a campaign whose chain creation is not confirmed", async () => {
        findCampaignWithProjection.mockResolvedValue({
            ...validCampaign,
            campaign: { ...validCampaign.campaign, chainCampaignId: null },
        });

        const result = await fundCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
            500n,
        );

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("rejects a campaign whose projection is not draft", async () => {
        findCampaignWithProjection.mockResolvedValue({
            ...validCampaign,
            projection: { status: "published" },
        });

        const result = await fundCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
            500n,
        );

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("rejects an owner without a wallet index", async () => {
        findUserWallet.mockResolvedValue({ walletIndex: null });

        const result = await fundCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
            500n,
        );

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it.each([
        0n,
        -1n,
    ])("rejects amount %s without enqueueing", async (amount) => {
        const result = await fundCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
            amount,
        );

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("enqueues approval with the owner wallet and decimal amount", async () => {
        const result = await fundCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
            500000000n,
        );

        expect(result.ok).toBe(true);
        expect(enqueueJob).toHaveBeenCalledOnce();
        const [tx, job] = enqueueJob.mock.calls[0];
        expect(tx).toEqual({});
        expect(job).toMatchObject({
            kind: "campaign_fund_approve",
            idempotencyKey: expect.stringMatching(
                /^campaign_fund_approve:campaign-1:/,
            ),
            payload: {
                campaignId: "campaign-1",
                chainCampaignId: 7,
                amount: "500000000",
                walletIndex: 12,
                fundingId: expect.any(String),
            },
        });
    });
});
