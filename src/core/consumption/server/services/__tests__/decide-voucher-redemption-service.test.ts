import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    requireCafeRole,
    findRedemptionRequestById,
    decideRedemptionRequest,
    mockSubmitVoucherRedemption,
    escrowSubmitVoucherRedemption,
    getBalance,
    incrementBalance,
    decrementBalance,
    consumerChainMode,
} = vi.hoisted(() => ({
    requireCafeRole: vi.fn(),
    findRedemptionRequestById: vi.fn(),
    decideRedemptionRequest: vi.fn(),
    mockSubmitVoucherRedemption: vi.fn(),
    escrowSubmitVoucherRedemption: vi.fn(),
    getBalance: vi.fn(),
    incrementBalance: vi.fn(),
    decrementBalance: vi.fn(),
    consumerChainMode: { value: undefined as "local" | "mock" | undefined },
}));

// El servicio lee el modo ya resuelto por ServerConfig, que fuera de tests
// cae en "local" cuando la variable no está puesta.
vi.mock("@/config/server-config", () => ({
    ServerConfig: new Proxy(
        {},
        {
            get: (_target, property) =>
                property === "consumerChainMode"
                    ? (consumerChainMode.value ?? "local")
                    : undefined,
        },
    ),
}));
vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole,
}));
vi.mock("@/core/punch/server/repository/balance", () => ({
    getBalance,
    incrementBalance,
    decrementBalance,
}));
vi.mock("../../repository/redemption-requests", () => ({
    findRedemptionRequestById,
    decideRedemptionRequest,
    RedemptionRequestRepositoryError: class extends Error {},
}));
vi.mock("../../postgres-mock-chain", () => ({
    PostgresMockConsumerChain: class {
        submitVoucherRedemption = mockSubmitVoucherRedemption;
    },
}));
vi.mock("../../campaign-escrow-chain", () => ({
    CampaignEscrowChain: class {
        submitVoucherRedemption = escrowSubmitVoucherRedemption;
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
        // Explícito: cada caso dice qué adaptador espera, y el de la variable
        // sin poner lo prueba aparte.
        consumerChainMode.value = "mock";
        requireCafeRole.mockResolvedValue({ ok: true, data: {} });
        findRedemptionRequestById.mockResolvedValue(pending);
        decideRedemptionRequest.mockResolvedValue({
            ...pending,
            status: "approved",
        });
        mockSubmitVoucherRedemption.mockResolvedValue({
            transactionId: "tx-1",
            status: "pending",
        });
        escrowSubmitVoucherRedemption.mockResolvedValue({
            transactionId: "escrow-tx-1",
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
        expect(mockSubmitVoucherRedemption).not.toHaveBeenCalled();
        expect(getBalance).not.toHaveBeenCalled();
        expect(incrementBalance).not.toHaveBeenCalled();
        expect(decrementBalance).not.toHaveBeenCalled();
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
            expect(mockSubmitVoucherRedemption).not.toHaveBeenCalled();
            expect(getBalance).not.toHaveBeenCalled();
            expect(incrementBalance).not.toHaveBeenCalled();
            expect(decrementBalance).not.toHaveBeenCalled();
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
        expect(getBalance).not.toHaveBeenCalled();
        expect(incrementBalance).not.toHaveBeenCalled();
        expect(decrementBalance).not.toHaveBeenCalled();
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
        expect(mockSubmitVoucherRedemption).not.toHaveBeenCalled();
        expect(getBalance).not.toHaveBeenCalled();
        expect(incrementBalance).not.toHaveBeenCalled();
        expect(decrementBalance).not.toHaveBeenCalled();
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
        expect(getBalance).not.toHaveBeenCalled();
        expect(incrementBalance).not.toHaveBeenCalled();
        expect(decrementBalance).not.toHaveBeenCalled();
    });

    it("selects the escrow adapter in local mode", async () => {
        consumerChainMode.value = "local";
        const result = await decideVoucherRedemptionService(
            "barista",
            "cafe-1",
            "req-1",
            { decision: "approved" },
        );
        expect(result).toEqual({
            ok: true,
            data: { transactionId: "escrow-tx-1", status: "pending" },
        });
        expect(escrowSubmitVoucherRedemption).toHaveBeenCalledWith({
            redemptionRequestId: "req-1",
            idempotencyKey: "voucher_redemption:req-1",
        });
    });

    it("uses the escrow when the chain mode variable is not set", async () => {
        // Regresión: leer la variable cruda daba undefined y mandaba el canje
        // al mock, así que la cafetería nunca cobraba su payout.
        consumerChainMode.value = undefined;
        const result = await decideVoucherRedemptionService(
            "barista",
            "cafe-1",
            "req-1",
            { decision: "approved" },
        );
        expect(result).toEqual({
            ok: true,
            data: { transactionId: "escrow-tx-1", status: "pending" },
        });
        expect(escrowSubmitVoucherRedemption).toHaveBeenCalled();
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
        expect(mockSubmitVoucherRedemption).toHaveBeenCalledTimes(1);
        expect(escrowSubmitVoucherRedemption).not.toHaveBeenCalled();
        expect(getBalance).not.toHaveBeenCalled();
        expect(incrementBalance).not.toHaveBeenCalled();
        expect(decrementBalance).not.toHaveBeenCalled();
    });
});
