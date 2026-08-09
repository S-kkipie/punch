import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/redemption-requests", () => ({
    approveRedemptionAndEnqueueJob: vi.fn(),
    decideRedemptionRequest: vi.fn(),
    findRedemptionRequestById: vi.fn(),
}));
vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole: vi.fn(),
}));
vi.mock("@/core/chain/server/wallet/repository", () => ({
    findUserWallet: vi.fn(),
}));

import { findUserWallet } from "@/core/chain/server/wallet/repository";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { ok } from "@/server/common/responses";
import {
    approveRedemptionAndEnqueueJob,
    decideRedemptionRequest,
    findRedemptionRequestById,
} from "../../repository/redemption-requests";
import { decidePunchRedemptionService } from "../decide-punch-redemption-service";

const request = {
    id: "r",
    kind: "punch_reward",
    consumerUserId: "consumer",
    cafeId: "c",
    productId: "p",
    voucherId: null,
    status: "pending",
    rejectionReason: null,
    decidedByUserId: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

const deps = {
    findCafeChainMapping: vi.fn(),
    findProductChainMapping: vi.fn(),
};

function authorize() {
    vi.mocked(requireCafeRole).mockResolvedValue(
        ok({ userId: "u", cafeId: "c", role: "barista" } as never),
    );
}

describe("decidePunchRedemptionService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authorize();
        vi.mocked(findRedemptionRequestById).mockResolvedValue(
            request as never,
        );
        vi.mocked(findUserWallet).mockResolvedValue({
            walletIndex: 1,
            walletAddress: "0xabc",
        });
        deps.findCafeChainMapping.mockResolvedValue({ chainCafeId: 3 });
        deps.findProductChainMapping.mockResolvedValue({ chainProductId: 7 });
        vi.mocked(approveRedemptionAndEnqueueJob).mockResolvedValue({
            ...request,
            status: "approved",
        } as never);
    });

    it("approving enqueues a punch_redemption job with resolved chain payload", async () => {
        const result = await decidePunchRedemptionService(
            "u",
            "c",
            "r",
            {
                decision: "approved",
            },
            deps,
        );
        expect(approveRedemptionAndEnqueueJob).toHaveBeenCalledWith("r", "u", {
            userWallet: "0xabc",
            chainCafeId: 3,
            chainProductId: 7,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.status).toBe("approved");
    });

    it("rejecting never enqueues", async () => {
        vi.mocked(decideRedemptionRequest).mockResolvedValue({
            ...request,
            status: "rejected",
        } as never);
        const result = await decidePunchRedemptionService(
            "u",
            "c",
            "r",
            {
                decision: "rejected",
                rejectionReason: "Sin stock",
            },
            deps,
        );
        expect(result.ok).toBe(true);
        expect(decideRedemptionRequest).toHaveBeenCalled();
        expect(approveRedemptionAndEnqueueJob).not.toHaveBeenCalled();
    });

    it("missing chain mapping returns 422 and does not enqueue", async () => {
        deps.findCafeChainMapping.mockResolvedValue({ chainCafeId: null });
        const result = await decidePunchRedemptionService(
            "u",
            "c",
            "r",
            {
                decision: "approved",
            },
            deps,
        );
        expect(result.ok).toBe(false);
        if (!result.ok && "targets" in result.error) {
            expect(result.error.targets).toEqual(["chainMapping"]);
        }
        expect(approveRedemptionAndEnqueueJob).not.toHaveBeenCalled();
    });

    it("missing consumer wallet returns 422", async () => {
        vi.mocked(findUserWallet).mockResolvedValue(null);
        const result = await decidePunchRedemptionService(
            "u",
            "c",
            "r",
            {
                decision: "approved",
            },
            deps,
        );
        expect(result.ok).toBe(false);
        if (!result.ok && "targets" in result.error) {
            expect(result.error.targets).toEqual(["wallet"]);
        }
    });

    it("re-approving an approved request is idempotent", async () => {
        vi.mocked(findRedemptionRequestById).mockResolvedValue({
            ...request,
            status: "approved",
        } as never);
        const result = await decidePunchRedemptionService(
            "u",
            "c",
            "r",
            {
                decision: "approved",
            },
            deps,
        );
        expect(result.ok).toBe(true);
        expect(approveRedemptionAndEnqueueJob).toHaveBeenCalled();
    });

    it("PostgresMockConsumerChain is no longer imported", async () => {
        const src = await readFile(
            "src/core/consumption/server/services/decide-punch-redemption-service.ts",
            "utf8",
        );
        expect(src).not.toContain("PostgresMockConsumerChain");
    });
});
