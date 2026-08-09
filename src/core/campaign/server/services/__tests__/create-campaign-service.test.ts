import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/server/common/responses";

const {
    requireCafeRole,
    findCafeById,
    insertCampaign,
    enqueueJob,
    transaction,
} = vi.hoisted(() => ({
    requireCafeRole: vi.fn(),
    findCafeById: vi.fn(),
    insertCampaign: vi.fn(),
    enqueueJob: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole,
}));
vi.mock("@/core/cafe/server/repository/find-cafe-by-id", () => ({
    findCafeById,
}));
vi.mock("@/core/campaign/server/repository/campaign-repository", () => ({
    insertCampaign,
}));
vi.mock("@/core/chain/server/relayer/job-repository", () => ({
    enqueueJob,
}));
vi.mock("@/server/drizzle/db", () => ({
    db: { transaction },
}));

import { createCampaignService } from "../create-campaign-service";

const input = {
    name: "Winter campaign",
    windowStart: new Date("2026-08-10T00:00:00.000Z"),
    windowEnd: new Date("2026-08-20T00:00:00.000Z"),
    voucherPayout: 100n,
    maxVouchers: 20,
};

beforeEach(() => {
    vi.clearAllMocks();
    requireCafeRole.mockResolvedValue(ok({}));
    findCafeById.mockResolvedValue({ id: "cafe-1", chainCafeId: 7 });
    transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({}),
    );
});

describe("createCampaignService", () => {
    it("rejects a non-owner", async () => {
        const forbidden = err({
            type: "ForbiddenError",
            code: "FORBIDDEN",
            status: 403,
        } as never);
        requireCafeRole.mockResolvedValue(forbidden);

        const result = await createCampaignService("user-1", "cafe-1", input);

        expect(result.ok).toBe(false);
        expect(insertCampaign).not.toHaveBeenCalled();
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it("inserts the campaign and enqueues one chain job", async () => {
        const result = await createCampaignService("user-1", "cafe-1", input);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(insertCampaign).toHaveBeenCalledOnce();
        expect(enqueueJob).toHaveBeenCalledOnce();
        const [tx, job] = enqueueJob.mock.calls[0];
        expect(tx).toEqual({});
        expect(job).toMatchObject({
            kind: "campaign_create",
            idempotencyKey: expect.stringMatching(/^campaign_create:/),
            payload: {
                campaignId: result.data.campaignId,
                chainCafeId: 7,
            },
        });
        expect(job.idempotencyKey).toBe(
            `campaign_create:${result.data.campaignId}`,
        );
    });

    it("rejects a cafe without a chain id before inserting", async () => {
        findCafeById.mockResolvedValue({ id: "cafe-1", chainCafeId: null });

        const result = await createCampaignService("user-1", "cafe-1", input);

        expect(result.ok).toBe(false);
        expect(insertCampaign).not.toHaveBeenCalled();
        expect(enqueueJob).not.toHaveBeenCalled();
    });
});
