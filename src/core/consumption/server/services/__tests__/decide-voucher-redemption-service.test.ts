import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    requireCafeRole,
    findRedemptionRequestById,
    decideRedemptionRequest,
    submitVoucherRedemption,
} = vi.hoisted(() => ({
    requireCafeRole: vi.fn(),
    findRedemptionRequestById: vi.fn(),
    decideRedemptionRequest: vi.fn(),
    submitVoucherRedemption: vi.fn(),
}));

vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole,
}));
vi.mock("../../repository/redemption-requests", () => ({
    findRedemptionRequestById,
    decideRedemptionRequest,
    RedemptionRequestRepositoryError: class extends Error {},
}));
vi.mock("../../postgres-mock-chain", () => ({
    PostgresMockConsumerChain: class {
        submitVoucherRedemption = submitVoucherRedemption;
    },
}));

import { decideVoucherRedemptionService } from "../decide-voucher-redemption-service";

const pending = {
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

describe("decideVoucherRedemptionService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requireCafeRole.mockResolvedValue({ ok: true, data: {} });
        findRedemptionRequestById.mockResolvedValue(pending);
        decideRedemptionRequest.mockResolvedValue({
            ...pending,
            status: "approved",
        });
        submitVoucherRedemption.mockResolvedValue({
            transactionId: "tx-1",
            status: "pending",
        });
    });

    it("denies outsiders before reading or writing the request", async () => {
        const error = { status: 403, code: "FORBIDDEN" };
        requireCafeRole.mockResolvedValue({ ok: false, error });
        const result = await decideVoucherRedemptionService(
            "outsider",
            "cafe-1",
            "req-1",
            {
                decision: "approved",
            },
        );
        expect(result).toEqual({ ok: false, error });
        expect(findRedemptionRequestById).not.toHaveBeenCalled();
        expect(submitVoucherRedemption).not.toHaveBeenCalled();
    });

    it("returns 404 for missing, foreign-café, and wrong-kind requests", async () => {
        for (const request of [
            null,
            { ...pending, cafeId: "cafe-2" },
            { ...pending, kind: "punch_reward" },
        ]) {
            vi.clearAllMocks();
            requireCafeRole.mockResolvedValue({ ok: true, data: {} });
            findRedemptionRequestById.mockResolvedValue(request);
            const result = await decideVoucherRedemptionService(
                "barista",
                "cafe-1",
                "req-1",
                { decision: "approved" },
            );
            expect(result.ok).toBe(false);
            expect(result.ok || result.error.status).toBe(404);
            expect(decideRedemptionRequest).not.toHaveBeenCalled();
            expect(submitVoucherRedemption).not.toHaveBeenCalled();
        }
    });

    it("does not call balance repositories for voucher decisions", async () => {
        const rejected = {
            ...pending,
            status: "rejected",
            rejectionReason: "Voucher no disponible",
        };
        decideRedemptionRequest.mockResolvedValue(rejected);
        const result = await decideVoucherRedemptionService(
            "barista",
            "cafe-1",
            "req-1",
            { decision: "rejected", rejectionReason: "Voucher no disponible" },
        );
        expect(result.ok).toBe(true);
    });

    it("rejects without chain or PUNCH effects and preserves voucher", async () => {
        const rejected = {
            ...pending,
            status: "rejected",
            rejectionReason: "Voucher no disponible",
        };
        decideRedemptionRequest.mockResolvedValue(rejected);
        const result = await decideVoucherRedemptionService(
            "barista",
            "cafe-1",
            "req-1",
            {
                decision: "rejected",
                rejectionReason: "Voucher no disponible",
            },
        );
        expect(result.ok && result.data).toMatchObject({ status: "rejected" });
        expect(submitVoucherRedemption).not.toHaveBeenCalled();
        expect(decideRedemptionRequest).toHaveBeenCalledWith(
            "req-1",
            "barista",
            "rejected",
            "Voucher no disponible",
        );
    });

    it("retries the same rejection idempotently but conflicts on changes", async () => {
        const rejected = {
            ...pending,
            status: "rejected",
            rejectionReason: "No disponible",
        };
        findRedemptionRequestById.mockResolvedValue(rejected);
        const same = await decideVoucherRedemptionService(
            "barista",
            "cafe-1",
            "req-1",
            {
                decision: "rejected",
                rejectionReason: "No disponible",
            },
        );
        expect(same.ok).toBe(true);
        const different = await decideVoucherRedemptionService(
            "barista",
            "cafe-1",
            "req-1",
            {
                decision: "rejected",
                rejectionReason: "Otro motivo",
            },
        );
        expect(different.ok || different.error.status).toBe(409);
        expect(decideRedemptionRequest).not.toHaveBeenCalled();
    });

    it("reuses approved chain submission and rejects approved-to-rejected", async () => {
        findRedemptionRequestById.mockResolvedValue({
            ...pending,
            status: "approved",
        });
        const retry = await decideVoucherRedemptionService(
            "barista",
            "cafe-1",
            "req-1",
            {
                decision: "approved",
            },
        );
        expect(retry.ok && retry.data).toEqual({
            transactionId: "tx-1",
            status: "pending",
        });
        expect(decideRedemptionRequest).not.toHaveBeenCalled();
        const conflict = await decideVoucherRedemptionService(
            "barista",
            "cafe-1",
            "req-1",
            {
                decision: "rejected",
                rejectionReason: "No disponible",
            },
        );
        expect(conflict.ok || conflict.error.status).toBe(409);
        expect(submitVoucherRedemption).toHaveBeenCalledTimes(1);
    });
});
