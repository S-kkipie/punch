import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repository/transactions", () => ({
    findTransactionById: vi.fn(),
    findTransactionByIdempotencyKey: vi.fn(),
    findTransactionByProofId: vi.fn(),
    findTransactionByRedemptionRequestId: vi.fn(),
    createTransaction: vi.fn(),
}));
vi.mock("../repository/proofs", () => ({
    findProofById: vi.fn(),
    bindProofSignatures: vi.fn(),
}));
vi.mock("../repository/redemption-requests", () => ({
    findRedemptionRequestById: vi.fn(),
}));
vi.mock("@/core/punch/server/repository/balance", () => ({
    getBalance: vi.fn(),
    incrementBalance: vi.fn(),
    decrementBalance: vi.fn(),
}));

import { getBalance } from "@/core/punch/server/repository/balance";
import { ConsumerChainError } from "../chain-port";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import { findTransactionById } from "../repository/transactions";

describe("PostgresMockConsumerChain.getPunchBalance", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns the projected balance", async () => {
        vi.mocked(getBalance).mockResolvedValue(11);
        const chain = new PostgresMockConsumerChain();
        expect(await chain.getPunchBalance("user-1")).toBe(11);
    });
});

describe("PostgresMockConsumerChain.getTransactionStatus", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns the transaction's current status", async () => {
        vi.mocked(findTransactionById).mockResolvedValue({
            id: "tx-1",
            status: "confirmed",
            rejectionReason: null,
        } as never);
        const chain = new PostgresMockConsumerChain();
        expect(await chain.getTransactionStatus("tx-1")).toEqual({
            transactionId: "tx-1",
            status: "confirmed",
            rejectionReason: undefined,
        });
    });

    it("throws TRANSACTION_NOT_FOUND for an unknown id", async () => {
        vi.mocked(findTransactionById).mockResolvedValue(null);
        const chain = new PostgresMockConsumerChain();
        await expect(chain.getTransactionStatus("missing")).rejects.toThrow(
            ConsumerChainError,
        );
    });
});
