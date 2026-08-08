import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/transactions", () => ({
    findTransactionByIdForConsumer: vi.fn(),
}));
const getTransactionStatus = vi.fn();
vi.mock("../../postgres-mock-chain", () => ({
    PostgresMockConsumerChain: vi.fn().mockImplementation(() => ({
        getTransactionStatus,
    })),
}));

import { findTransactionByIdForConsumer } from "../../repository/transactions";
import { getTransactionStatusService } from "../get-transaction-status-service";

describe("getTransactionStatusService", () => {
    beforeEach(() => vi.clearAllMocks());

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
});
