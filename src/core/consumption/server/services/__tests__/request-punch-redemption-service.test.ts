import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/redemption-requests", () => ({
    createRedemptionRequest: vi.fn(),
}));
vi.mock("@/core/cafe/server/repository/find-product-by-id", () => ({
    findProductById: vi.fn(),
}));
vi.mock("@/core/punch/server/repository/balance", () => ({
    getBalance: vi.fn(),
}));

import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { getBalance } from "@/core/punch/server/repository/balance";
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
        vi.mocked(getBalance).mockResolvedValue(balance);
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
        vi.mocked(getBalance).mockResolvedValue(12);
        vi.mocked(findProductById).mockResolvedValue(candidate as never);
        const result = await requestPunchRedemptionService("u", "c", {
            productId: "p",
        });
        expect(result.ok).toBe(false);
    });

    it("allows a reward priced at the S/12 cap", async () => {
        vi.mocked(getBalance).mockResolvedValue(12);
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
