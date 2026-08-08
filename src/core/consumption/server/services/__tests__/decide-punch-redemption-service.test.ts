import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/redemption-requests", () => ({
    decideRedemptionRequest: vi.fn(),
    findRedemptionRequestById: vi.fn(),
}));
vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole: vi.fn(),
}));
vi.mock("../../postgres-mock-chain", () => ({
    PostgresMockConsumerChain: vi.fn().mockImplementation(() => ({
        submitPunchRedemption: vi.fn().mockResolvedValue({
            transactionId: "tx",
            status: "pending",
        }),
    })),
}));

import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { ok } from "@/server/common/responses";
import {
    decideRedemptionRequest,
    findRedemptionRequestById,
} from "../../repository/redemption-requests";
import { decidePunchRedemptionService } from "../decide-punch-redemption-service";

const rejectedRequest = {
    id: "r",
    kind: "punch_reward",
    cafeId: "c",
    productId: "p",
    voucherId: null,
    status: "rejected",
    rejectionReason: "Sin stock",
    createdAt: new Date(),
};

describe("decidePunchRedemptionService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(findRedemptionRequestById).mockResolvedValue({
            ...rejectedRequest,
            status: "pending",
        } as never);
    });

    it("authorizes barista and submits approval", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(
            ok({ userId: "u", cafeId: "c", role: "barista" } as never),
        );
        vi.mocked(decideRedemptionRequest).mockResolvedValue({
            ...rejectedRequest,
            status: "approved",
            rejectionReason: null,
        } as never);
        const result = await decidePunchRedemptionService("u", "c", "r", {
            decision: "approved",
        });
        expect(result.ok).toBe(true);
    });

    it.each([
        null,
        { ...rejectedRequest, cafeId: "other" },
        { ...rejectedRequest, kind: "voucher" },
    ])("denies missing, foreign, or wrong-kind requests", async (request) => {
        vi.mocked(findRedemptionRequestById).mockResolvedValue(
            request as never,
        );
        const result = await decidePunchRedemptionService("u", "c", "r", {
            decision: "approved",
        });
        expect(result.ok).toBe(false);
        expect(decideRedemptionRequest).not.toHaveBeenCalled();
    });

    it("rejects with actionable reason without chain", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(ok({} as never));
        vi.mocked(decideRedemptionRequest).mockResolvedValue(
            rejectedRequest as never,
        );
        const result = await decidePunchRedemptionService("u", "c", "r", {
            decision: "rejected",
            rejectionReason: "Sin stock",
        });
        expect(result.ok).toBe(true);
        expect(decideRedemptionRequest).toHaveBeenCalledWith(
            "r",
            "u",
            "rejected",
            "Sin stock",
        );
    });
});
