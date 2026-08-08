import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/redemption-requests", () => ({
    createRedemptionRequest: vi.fn(),
    findActiveVoucherRedemptionRequest: vi.fn(),
}));
vi.mock("@/core/punch/server/repository/vouchers", () => ({
    findVoucherById: vi.fn(),
    isVoucherEligibleAtCafe: vi.fn(),
}));

import { findVoucherById } from "@/core/punch/server/repository/vouchers";
import {
    createRedemptionRequest,
    findActiveVoucherRedemptionRequest,
} from "../../repository/redemption-requests";
import { requestVoucherRedemptionService } from "../request-voucher-redemption-service";

const voucher = {
    id: "v1",
    source: "campaign",
    cafeId: "cafe-1",
    consumerUserId: "user-1",
    status: "available",
    expiresAt: new Date(Date.now() + 60_000),
};
const request = {
    id: "req-1",
    kind: "voucher",
    consumerUserId: "user-1",
    cafeId: "cafe-1",
    productId: null,
    voucherId: "v1",
    status: "pending",
    rejectionReason: null,
    createdAt: new Date(),
};

describe("requestVoucherRedemptionService concurrency", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(findVoucherById).mockResolvedValue(voucher as never);
        vi.mocked(findActiveVoucherRedemptionRequest).mockResolvedValue(null);
        vi.mocked(createRedemptionRequest).mockResolvedValue(request as never);
    });

    it("returns the winning same-consumer same-café request after the unique race", async () => {
        vi.mocked(createRedemptionRequest).mockRejectedValue({
            code: "23505",
            constraint: "redemption_request_active_voucher_uq",
        });
        vi.mocked(findActiveVoucherRedemptionRequest)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(request as never);

        const result = await requestVoucherRedemptionService(
            "user-1",
            "cafe-1",
            {
                voucherId: "v1",
            },
        );

        expect(result.ok).toBe(true);
        expect(result.ok && result.data.id).toBe("req-1");
    });

    it("propagates unrelated database errors", async () => {
        const failure = new Error("database unavailable");
        vi.mocked(createRedemptionRequest).mockRejectedValue(failure);
        await expect(
            requestVoucherRedemptionService("user-1", "cafe-1", {
                voucherId: "v1",
            }),
        ).rejects.toBe(failure);
    });
});
