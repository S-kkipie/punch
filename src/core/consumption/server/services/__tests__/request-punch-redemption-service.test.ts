import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/redemption-requests", () => ({
    createRedemptionRequest: vi.fn(),
}));
vi.mock("@/core/cafe/server/repository/find-product-by-id", () => ({
    findProductById: vi.fn(),
}));
vi.mock("@/core/purchase/server/services/get-balance-service", () => ({
    getConsumerBalance: vi.fn(),
}));

import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { getConsumerBalance } from "@/core/purchase/server/services/get-balance-service";
import { createRedemptionRequest } from "../../repository/redemption-requests";
import { requestPunchRedemptionService } from "../request-punch-redemption-service";

const product = {
    id: "p",
    cafeId: "c",
    type: "reward" as const,
    approvalStatus: "approved" as const,
    active: true,
    priceSoles: "12.00",
};

describe("requestPunchRedemptionService", () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([11, 0])("blocks balance %s", async (balance) => {
        vi.mocked(getConsumerBalance).mockResolvedValue({
            ok: true,
            data: { punchBalance: balance, stale: false },
        });
        vi.mocked(findProductById).mockResolvedValue(product as never);
        const result = await requestPunchRedemptionService("u", "c", {
            productId: "p",
        });
        expect(result.ok).toBe(false);
        expect(createRedemptionRequest).not.toHaveBeenCalled();
    });

    it.each([
        { ...product, cafeId: "other" },
        { ...product, type: "standard" },
        { ...product, approvalStatus: "pending" },
        { ...product, active: false },
        { ...product, priceSoles: "12.01" },
    ])("blocks invalid reward product", async (candidate) => {
        vi.mocked(getConsumerBalance).mockResolvedValue({
            ok: true,
            data: { punchBalance: 12, stale: false },
        });
        vi.mocked(findProductById).mockResolvedValue(candidate as never);
        const result = await requestPunchRedemptionService("u", "c", {
            productId: "p",
        });
        expect(result.ok).toBe(false);
    });

    it("blocks a stale null balance", async () => {
        vi.mocked(getConsumerBalance).mockResolvedValue({
            ok: true,
            data: { punchBalance: null, stale: true },
        });
        vi.mocked(findProductById).mockResolvedValue(product as never);
        const result = await requestPunchRedemptionService("u", "c", {
            productId: "p",
        });
        expect(result.ok).toBe(false);
        expect(createRedemptionRequest).not.toHaveBeenCalled();
    });

    it("allows a reward priced at the S/12 cap", async () => {
        vi.mocked(getConsumerBalance).mockResolvedValue({
            ok: true,
            data: { punchBalance: 12, stale: false },
        });
        vi.mocked(findProductById).mockResolvedValue(product as never);
        vi.mocked(createRedemptionRequest).mockResolvedValue({
            id: "r",
            kind: "punch_reward",
            cafeId: "c",
            productId: "p",
            voucherId: null,
            status: "pending",
            rejectionReason: null,
            createdAt: new Date(),
        } as never);
        const result = await requestPunchRedemptionService("u", "c", {
            productId: "p",
        });
        expect(result.ok).toBe(true);
    });
});
