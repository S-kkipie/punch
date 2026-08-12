import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole: vi.fn(),
}));
vi.mock("../../repository/campaign-repository", () => ({
    listCafeCampaigns: vi.fn(),
    listCampaignChainOps: vi.fn(async () => []),
}));
vi.mock("@/core/purchase/server/repository/purchase-repository", () => ({
    findUserWallet: vi.fn(async () => ({
        walletIndex: 1,
        walletAddress: "0x00000000000000000000000000000000000000aa",
    })),
}));

const readMpenBalance = vi.fn<() => Promise<bigint>>(async () => 7_000_000n);

import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { ok } from "@/server/common/responses";
import {
    listCafeCampaigns,
    listCampaignChainOps,
} from "../../repository/campaign-repository";
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
        const result = await listCafeCampaignsService("user-1", "cafe-1", {
            readMpenBalance,
        });
        expect(result.ok).toBe(true);
        expect(requireCafeRole).toHaveBeenCalledTimes(1);
        expect(requireCafeRole).toHaveBeenCalledWith("user-1", "cafe-1", [
            "owner",
        ]);
        expect(listCafeCampaigns).toHaveBeenCalledTimes(1);
        expect(
            result.ok &&
                result.data.campaigns.map(
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

describe("listCafeCampaignsService wallet balance", () => {
    beforeEach(() => vi.clearAllMocks());

    it("reports the wallet balance the café can actually commit", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(ok({}) as never);
        vi.mocked(listCafeCampaigns).mockResolvedValue([] as never);
        readMpenBalance.mockResolvedValue(3_600_000n);

        const result = await listCafeCampaignsService("user-1", "cafe-1", {
            readMpenBalance,
        });

        expect(result.ok && result.data.walletBalance).toBe(3_600_000n);
    });
});

describe("listCafeCampaignsService chain operations", () => {
    beforeEach(() => vi.clearAllMocks());

    it("hands each campaign its own chain writes, newest first", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(ok({}) as never);
        vi.mocked(listCafeCampaigns).mockResolvedValue([
            campaign("first", 7, { status: "draft", budget: 12n }),
            campaign("second", 8, { status: "draft", budget: 12n }),
        ] as never);
        vi.mocked(listCampaignChainOps).mockResolvedValue([
            {
                campaignId: "first",
                kind: "campaign_publish",
                status: "submitted",
                txHash: "0xpublish",
                error: null,
                createdAt: new Date("2026-08-12T10:00:00.000Z"),
            },
            {
                campaignId: "first",
                kind: "campaign_create",
                status: "confirmed",
                txHash: "0xcreate",
                error: null,
                createdAt: new Date("2026-08-12T09:00:00.000Z"),
            },
        ] as never);

        const result = await listCafeCampaignsService("user-1", "cafe-1", {
            readMpenBalance,
        });

        expect(
            result.ok &&
                result.data.campaigns.map((row) => ({
                    id: row.id,
                    hashes: row.chainOps.map((op) => op.txHash),
                })),
        ).toEqual([
            { id: "first", hashes: ["0xpublish", "0xcreate"] },
            { id: "second", hashes: [] },
        ]);
    });
});
