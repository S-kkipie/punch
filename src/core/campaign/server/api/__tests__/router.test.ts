import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/server/auth/auth")>();
    return {
        ...actual,
        auth: {
            ...actual.auth,
            api: { ...actual.auth.api, getSession: vi.fn() },
        },
    };
});
vi.mock("../../services/create-campaign-service", () => ({
    createCampaignService: vi.fn(),
}));
vi.mock("../../services/fund-campaign-service", () => ({
    fundCampaignService: vi.fn(),
}));
vi.mock("../../services/publish-campaign-service", () => ({
    publishCampaignService: vi.fn(),
}));
vi.mock("../../services/list-cafe-campaigns-service", () => ({
    listCafeCampaignsService: vi.fn(),
}));

import { auth } from "@/server/auth/auth";
import { err, ok } from "@/server/common/responses";
import app from "@/server/router";
import { createCampaignService } from "../../services/create-campaign-service";
import { fundCampaignService } from "../../services/fund-campaign-service";
import { listCafeCampaignsService } from "../../services/list-cafe-campaigns-service";
import { publishCampaignService } from "../../services/publish-campaign-service";

const session = { user: { id: "user-1" }, session: { id: "session-1" } };
const request = (path: string, init?: RequestInit) =>
    app.handle(new Request(`http://localhost${path}`, init));
const authed = (path: string, init?: RequestInit) => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
    return request(path, init);
};
const json = (value: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
});

describe("campaign API routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auth.api.getSession).mockResolvedValue(null);
    });
    it("requires auth and validates payout before calling create service", async () => {
        expect(
            (
                await request(
                    "/api/v1/cafe/cafe-1/campaigns",
                    json({
                        name: "x",
                        windowStart: "2026-08-09T00:00:00.000Z",
                        windowEnd: "2026-08-10T00:00:00.000Z",
                        voucherPayout: "1",
                        maxVouchers: 2,
                    }),
                )
            ).status,
        ).toBe(401);
        expect(
            (
                await authed(
                    "/api/v1/cafe/cafe-1/campaigns",
                    json({
                        name: "x",
                        windowStart: "2026-08-09T00:00:00.000Z",
                        windowEnd: "2026-08-10T00:00:00.000Z",
                        voucherPayout: "0",
                        maxVouchers: 2,
                    }),
                )
            ).status,
        ).toBe(400);
        expect(createCampaignService).not.toHaveBeenCalled();
    });
    it("passes transformed create values and exact funding/publish args", async () => {
        vi.mocked(createCampaignService).mockResolvedValue(
            ok({ campaignId: "campaign-1" }),
        );
        const created = await authed(
            "/api/v1/cafe/cafe-1/campaigns",
            json({
                name: "x",
                windowStart: "2026-08-09T00:00:00.000Z",
                windowEnd: "2026-08-10T00:00:00.000Z",
                voucherPayout: "1000000000000000000",
                maxVouchers: 2,
            }),
        );
        expect(created.status).toBe(201);
        expect(createCampaignService).toHaveBeenCalledWith(
            "user-1",
            "cafe-1",
            expect.objectContaining({
                voucherPayout: 1000000000000000000n,
                maxVouchers: 2,
            }),
        );
        vi.mocked(fundCampaignService).mockResolvedValue(
            ok({ fundingId: "fund-1" }),
        );
        await authed(
            "/api/v1/cafe/cafe-1/campaigns/campaign-1/fund",
            json({ amount: "42" }),
        );
        expect(fundCampaignService).toHaveBeenCalledWith(
            "user-1",
            "cafe-1",
            "campaign-1",
            42n,
        );
        vi.mocked(publishCampaignService).mockResolvedValue(
            ok({ queued: true }),
        );
        await authed("/api/v1/cafe/cafe-1/campaigns/campaign-1/publish", {
            method: "POST",
        });
        expect(publishCampaignService).toHaveBeenCalledWith(
            "user-1",
            "cafe-1",
            "campaign-1",
        );
    });
    it("serializes list bigint values as decimal strings and maps service errors", async () => {
        vi.mocked(listCafeCampaignsService).mockResolvedValue(
            ok([
                {
                    id: "campaign-1",
                    cafeId: "cafe-1",
                    name: "x",
                    windowStart: new Date("2026-08-09T00:00:00.000Z"),
                    windowEnd: new Date("2026-08-10T00:00:00.000Z"),
                    voucherPayout: 9n,
                    maxVouchers: 2,
                    lifecycle: "draft",
                    required: 18n,
                    funded: 9n,
                    missing: 9n,
                    canPublish: false,
                },
            ]),
        );
        const response = await authed("/api/v1/cafe/cafe-1/campaigns");
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            response: [
                {
                    voucherPayout: "9",
                    required: "18",
                    funded: "9",
                    missing: "9",
                },
            ],
        });
        vi.mocked(publishCampaignService).mockResolvedValue(
            err({ type: "ForbiddenError", code: "FORBIDDEN", status: 403 }),
        );
        expect(
            (
                await authed(
                    "/api/v1/cafe/cafe-1/campaigns/campaign-1/publish",
                    { method: "POST" },
                )
            ).status,
        ).toBe(403);
    });
});
