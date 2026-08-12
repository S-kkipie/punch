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

import { cancelCampaignService } from "../cancel-campaign-service";

const draft = {
    campaign: { id: "campaign-1", cafeId: "cafe-1", chainCampaignId: 7 },
    projection: { status: "draft" },
};

beforeEach(() => {
    vi.clearAllMocks();
    requireCafeRole.mockResolvedValue(ok({ role: "owner" }));
    findCampaignWithProjection.mockResolvedValue(draft);
    transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({}),
    );
    enqueueJob.mockResolvedValue({ id: "job-1" });
});

describe("cancelCampaignService", () => {
    it("queues the cancellation for a draft the owner owns", async () => {
        const result = await cancelCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
        );

        expect(result.ok).toBe(true);
        expect(enqueueJob).toHaveBeenCalledWith(
            {},
            {
                kind: "campaign_cancel",
                idempotencyKey: "campaign_cancel:campaign-1",
                payload: { campaignId: "campaign-1", chainCampaignId: 7 },
            },
        );
    });

    it("refuses to cancel a published campaign", async () => {
        // Una campaña publicada no se cancela nunca: es la garantía de que el
        // voucher que el cliente ya ganó vale.
        findCampaignWithProjection.mockResolvedValue({
            ...draft,
            projection: { status: "published" },
        });

        const result = await cancelCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
        );

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("refuses a campaign that belongs to another café", async () => {
        findCampaignWithProjection.mockResolvedValue({
            ...draft,
            campaign: { ...draft.campaign, cafeId: "cafe-2" },
        });

        const result = await cancelCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
        );

        expect(result.ok || result.error.status).toBe(404);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("refuses a caller who is not the owner", async () => {
        requireCafeRole.mockResolvedValue(
            err({
                type: "ForbiddenError",
                code: "FORBIDDEN",
                status: 403,
            } as never),
        );

        const result = await cancelCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
        );

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("refuses a campaign that never reached the chain", async () => {
        findCampaignWithProjection.mockResolvedValue({
            campaign: {
                id: "campaign-1",
                cafeId: "cafe-1",
                chainCampaignId: null,
            },
            projection: null,
        });

        const result = await cancelCampaignService(
            "user-1",
            "cafe-1",
            "campaign-1",
        );

        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });
});
