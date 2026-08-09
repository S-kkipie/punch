import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/server/common/responses";

const { requireCafeRole, findCampaignWithProjection, enqueueJob, transaction } =
    vi.hoisted(() => ({
        requireCafeRole: vi.fn(),
        findCampaignWithProjection: vi.fn(),
        enqueueJob: vi.fn(),
        transaction: vi.fn(),
    }));

vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole,
}));
vi.mock("@/core/campaign/server/repository/campaign-repository", () => ({
    findCampaignWithProjection,
}));
vi.mock("@/core/chain/server/relayer/job-repository", () => ({ enqueueJob }));
vi.mock("@/server/drizzle/db", () => ({ db: { transaction } }));

import { publishCampaignService } from "../publish-campaign-service";

const validCampaign = {
    campaign: {
        id: "camp-1",
        cafeId: "cafe-1",
        voucherPayout: 50n,
        maxVouchers: 10,
        chainCampaignId: 3,
        windowEnd: new Date("2030-01-02T03:04:05.000Z"),
    },
    projection: { status: "draft", budget: 500n },
};

beforeEach(() => {
    vi.clearAllMocks();
    requireCafeRole.mockResolvedValue(ok({ role: "owner" }));
    findCampaignWithProjection.mockResolvedValue(validCampaign);
    transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({}),
    );
    enqueueJob.mockResolvedValue({ id: "job-1" });
});

describe("publishCampaignService", () => {
    it("does not enqueue when the chain budget is short", async () => {
        findCampaignWithProjection.mockResolvedValue({
            ...validCampaign,
            projection: { status: "draft", budget: 499n },
        });

        const result = await publishCampaignService("u1", "cafe-1", "camp-1");

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("enqueues one publish job when the budget covers every voucher", async () => {
        const result = await publishCampaignService("u1", "cafe-1", "camp-1");

        expect(result).toEqual({ ok: true, data: { queued: true } });
        expect(enqueueJob).toHaveBeenCalledOnce();
        expect(enqueueJob).toHaveBeenCalledWith(
            {},
            {
                kind: "campaign_publish",
                idempotencyKey: "campaign_publish:camp-1",
                payload: {
                    campaignId: "camp-1",
                    chainCampaignId: 3,
                    voucherPayout: "50",
                    maxVouchers: 10,
                    windowEnd: "2030-01-02T03:04:05.000Z",
                },
            },
        );
    });

    it("rejects a campaign that is already published", async () => {
        findCampaignWithProjection.mockResolvedValue({
            ...validCampaign,
            projection: { status: "published", budget: 500n },
        });

        const result = await publishCampaignService("u1", "cafe-1", "camp-1");

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("maps an idempotency duplicate to success", async () => {
        enqueueJob.mockResolvedValue(null);

        const result = await publishCampaignService("u1", "cafe-1", "camp-1");

        expect(result).toEqual({ ok: true, data: { queued: true } });
        expect(enqueueJob).toHaveBeenCalledOnce();
    });

    it("requires cafe owner authorization", async () => {
        requireCafeRole.mockResolvedValue(
            err({
                type: "ForbiddenError",
                code: "FORBIDDEN",
                status: 403,
            } as never),
        );

        const result = await publishCampaignService("u1", "cafe-1", "camp-1");

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });
});
