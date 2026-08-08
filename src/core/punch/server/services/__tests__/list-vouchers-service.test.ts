import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/dashboard", () => ({
    listConsumerVouchersForUser: vi.fn(),
}));

import { listConsumerVouchersForUser } from "../../repository/dashboard";
import { listVouchersService } from "../list-vouchers-service";

const row = (overrides: Record<string, unknown> = {}) => ({
    id: "voucher-1",
    source: "campaign",
    campaignId: "campaign-1",
    crawlId: null,
    consumerUserId: "user-1",
    cafeId: "cafe-1",
    status: "available",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    redeemedAt: null,
    createdAt: new Date(),
    ...overrides,
});

describe("listVouchersService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("passes userId to the repository and never returns foreign rows", async () => {
        vi.mocked(listConsumerVouchersForUser).mockImplementation(
            async (userId) =>
                userId === "user-1"
                    ? ([row()] as never)
                    : ([
                          row({ consumerUserId: "user-2", id: "foreign" }),
                      ] as never),
        );
        const result = await listVouchersService("user-1");
        expect(listConsumerVouchersForUser).toHaveBeenCalledWith("user-1");
        expect(result.ok && result.data.map((voucher) => voucher.id)).toEqual([
            "voucher-1",
        ]);
    });

    it("maps available vouchers past server time to expired without mutating storage", async () => {
        vi.mocked(listConsumerVouchersForUser).mockResolvedValue([
            row({ expiresAt: new Date("2000-01-01T00:00:00.000Z") }),
            row({
                id: "redeemed",
                status: "redeemed",
                expiresAt: new Date("2000-01-01T00:00:00.000Z"),
            }),
        ] as never);
        const result = await listVouchersService("user-1");
        expect(
            result.ok && result.data.map((voucher) => voucher.status),
        ).toEqual(["expired", "redeemed"]);
    });
});
