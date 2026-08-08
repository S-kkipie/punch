import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/transactions", () => ({
    findTransactionById: vi.fn(),
    findTransactionByIdForConsumer: vi.fn(),
}));
const { requireCafeRole } = vi.hoisted(() => ({ requireCafeRole: vi.fn() }));
vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole,
}));
const getTransactionStatus = vi.fn();
vi.mock("../../postgres-mock-chain", () => ({
    PostgresMockConsumerChain: vi.fn().mockImplementation(() => ({
        getTransactionStatus,
    })),
}));

import {
    findTransactionById,
    findTransactionByIdForConsumer,
} from "../../repository/transactions";
import { getTransactionStatusService } from "../get-transaction-status-service";

describe("getTransactionStatusService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(findTransactionById).mockResolvedValue(null);
        requireCafeRole.mockResolvedValue({
            ok: false,
            error: { status: 403 },
        });
    });

    it("allows the owner to poll", async () => {
        vi.mocked(findTransactionByIdForConsumer).mockResolvedValue({
            id: "tx-1",
            consumerUserId: "user-1",
        } as never);
        getTransactionStatus.mockResolvedValue({
            transactionId: "tx-1",
            status: "pending",
        });

        await expect(
            getTransactionStatusService("user-1", "tx-1"),
        ).resolves.toEqual({
            ok: true,
            data: { transactionId: "tx-1", status: "pending" },
        });
        expect(getTransactionStatus).toHaveBeenCalledWith("tx-1");
    });

    it.each([
        ["foreign", null],
        ["missing", null],
    ])("returns 404 without polling for %s transaction", async (_, row) => {
        vi.mocked(findTransactionByIdForConsumer).mockResolvedValue(row);

        const result = await getTransactionStatusService("user-2", "tx-1");

        expect(result).toMatchObject({ ok: false, error: { status: 404 } });
        expect(getTransactionStatus).not.toHaveBeenCalled();
    });

    it.each([
        "punch_redemption",
        "voucher_redemption",
    ] as const)("allows an owning café member to poll %s", async (operation) => {
        vi.mocked(findTransactionByIdForConsumer).mockResolvedValue(null);
        vi.mocked(findTransactionById).mockResolvedValue({
            id: "tx-1",
            operation,
            cafeId: "cafe-1",
        } as never);
        requireCafeRole.mockResolvedValue({ ok: true, data: {} });
        getTransactionStatus.mockResolvedValue({
            transactionId: "tx-1",
            status: "confirmed",
        });

        await expect(
            getTransactionStatusService("barista-1", "tx-1", "cafe-1"),
        ).resolves.toMatchObject({ ok: true, data: { status: "confirmed" } });
        expect(requireCafeRole).toHaveBeenCalledWith("barista-1", "cafe-1", [
            "owner",
            "barista",
        ]);
        expect(getTransactionStatus).toHaveBeenCalledWith("tx-1");
    });

    it.each([
        ["foreign café", "cafe-2", { ok: true, data: {} }],
        ["unrelated user", "cafe-1", { ok: false, error: { status: 403 } }],
    ])("returns the same 404 for %s redemption", async (_, cafeId, membership) => {
        vi.mocked(findTransactionByIdForConsumer).mockResolvedValue(null);
        vi.mocked(findTransactionById).mockResolvedValue({
            id: "tx-1",
            operation: "punch_redemption",
            cafeId: "cafe-1",
        } as never);
        requireCafeRole.mockResolvedValue(membership);

        const result = await getTransactionStatusService(
            "user-2",
            "tx-1",
            cafeId,
        );

        expect(result).toMatchObject({ ok: false, error: { status: 404 } });
        expect(getTransactionStatus).not.toHaveBeenCalled();
    });
});
