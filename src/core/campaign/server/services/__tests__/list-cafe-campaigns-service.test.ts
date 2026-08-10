import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole: vi.fn(),
}));
vi.mock("../../repository/campaign-repository", () => ({
    listCafeCampaigns: vi.fn(),
}));

import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { ok } from "@/server/common/responses";
import { listCafeCampaigns } from "../../repository/campaign-repository";
import { listCafeCampaignsService } from "../list-cafe-campaigns-service";

const campaign = (
    id: string,
    chainCampaignId: number | null,
    projection: {
        status: "draft" | "published" | "cancelled";
        budget: bigint;
    } | null,
) => ({
    campaign: {
        id,
        cafeId: "cafe-1",
        name: id,
        windowStart: new Date("2026-08-09T00:00:00.000Z"),
        windowEnd: new Date("2026-08-10T00:00:00.000Z"),
        voucherPayout: 3n,
        maxVouchers: 4,
        chainCampaignId,
    },
    projection,
});

describe("listCafeCampaignsService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("authorizes and reads once, mapping all funding from the loaded projections", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(ok({}) as never);
        vi.mocked(listCafeCampaigns).mockResolvedValue([
            campaign("creating", null, null),
            campaign("funded", 7, { status: "draft", budget: 12n }),
        ] as never);
        const result = await listCafeCampaignsService("user-1", "cafe-1");
        expect(result.ok).toBe(true);
        expect(requireCafeRole).toHaveBeenCalledTimes(1);
        expect(requireCafeRole).toHaveBeenCalledWith("user-1", "cafe-1", [
            "owner",
        ]);
        expect(listCafeCampaigns).toHaveBeenCalledTimes(1);
        expect(
            result.ok &&
                result.data.map(
                    ({ lifecycle, funded, missing, canPublish }) => ({
                        lifecycle,
                        funded,
                        missing,
                        canPublish,
                    }),
                ),
        ).toEqual([
            {
                lifecycle: "creating",
                funded: 0n,
                missing: 12n,
                canPublish: false,
            },
            { lifecycle: "draft", funded: 12n, missing: 0n, canPublish: true },
        ]);
    });
});
