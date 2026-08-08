import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/drizzle/db", () => ({
    db: { transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})) },
}));
vi.mock("../repository/transactions", () => ({
    findTransactionById: vi.fn(),
    findTransactionByIdempotencyKey: vi.fn(),
    findTransactionByProofId: vi.fn(),
    findTransactionByRedemptionRequestId: vi.fn(),
    createTransaction: vi.fn(),
    updateTransactionStatus: vi.fn(),
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
vi.mock("@/core/punch/domain/campaign", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/core/punch/domain/campaign")>();
    return {
        ...actual,
        isEligibleForAcquisitionCampaign: vi.fn(
            actual.isEligibleForAcquisitionCampaign,
        ),
    };
});

import { isEligibleForAcquisitionCampaign } from "@/core/punch/domain/campaign";
import {
    getBalance,
    incrementBalance,
} from "@/core/punch/server/repository/balance";
import { ConsumerChainError } from "../chain-port";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import { findProofById } from "../repository/proofs";
import {
    createTransaction,
    findTransactionById,
    findTransactionByIdempotencyKey,
    findTransactionByProofId,
    updateTransactionStatus,
} from "../repository/transactions";

describe("PostgresMockConsumerChain.getPunchBalance", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns the projected balance", async () => {
        vi.mocked(getBalance).mockResolvedValue(11);
        const chain = new PostgresMockConsumerChain();
        expect(await chain.getPunchBalance("user-1")).toBe(11);
    });
});

describe("PostgresMockConsumerChain.submitConsumption", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns an existing idempotent transaction without opening a transaction", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue({
            id: "tx-1",
            status: "confirmed",
        } as never);
        await expect(
            new PostgresMockConsumerChain().submitConsumption({
                proofId: "proof-1",
                idempotencyKey: "key-1",
            }),
        ).resolves.toEqual({ transactionId: "tx-1", status: "confirmed" });
    });

    it("creates a pending transaction without incrementing balance", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            status: "confirmed",
            consumerUserId: "user-1",
            cafeId: "cafe-1",
            expiresAt: new Date(Date.now() + 60_000),
        } as never);
        vi.mocked(findTransactionByProofId).mockResolvedValue(null);
        vi.mocked(createTransaction).mockResolvedValue({
            id: "tx-new",
            status: "pending",
        } as never);
        await expect(
            new PostgresMockConsumerChain().submitConsumption({
                proofId: "proof-1",
                idempotencyKey: "key-2",
            }),
        ).resolves.toEqual({ transactionId: "tx-new", status: "pending" });
        expect(incrementBalance).not.toHaveBeenCalled();
    });
});

vi.mock("@/core/punch/server/repository/campaigns", () => ({
    findActiveCampaignForCafe: vi.fn(),
    hasPriorPaidPurchase: vi.fn(),
    unlockCampaignVoucher: vi.fn(),
}));
vi.mock("@/core/punch/server/repository/crawls", () => ({
    findActiveCrawlForCafe: vi.fn(),
    getCrawlSteps: vi.fn(),
    getOrCreateCrawlProgress: vi.fn(),
    advanceCrawlProgress: vi.fn(),
    unlockCrawlVoucher: vi.fn(),
}));

import {
    findActiveCampaignForCafe,
    hasPriorPaidPurchase,
    unlockCampaignVoucher,
} from "@/core/punch/server/repository/campaigns";
import {
    advanceCrawlProgress,
    findActiveCrawlForCafe,
    getCrawlSteps,
    getOrCreateCrawlProgress,
    unlockCrawlVoucher,
} from "@/core/punch/server/repository/crawls";

async function finalizeEmission(key: string) {
    const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
    const submission = await chain.submitConsumption({
        proofId: "proof-1",
        idempotencyKey: key,
    });
    vi.mocked(findTransactionById).mockResolvedValue({
        id: submission.transactionId,
        status: "pending",
        operation: "emission",
        proofId: "proof-1",
        createdAt: new Date(0),
    } as never);
    vi.mocked(findProofById).mockResolvedValue({
        id: "proof-1",
        consumerUserId: "user-1",
        cafeId: "cafe-target",
    } as never);
    await chain.getTransactionStatus(submission.transactionId);
}

describe("PostgresMockConsumerChain.submitConsumption campaign + crawl side effects", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            status: "confirmed",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
            expiresAt: new Date(Date.now() + 60_000),
        } as never);
        vi.mocked(findTransactionByProofId).mockResolvedValue(null);
        vi.mocked(createTransaction).mockResolvedValue({
            id: "tx-new",
            status: "pending",
        } as never);
        vi.mocked(updateTransactionStatus).mockResolvedValue({
            id: "tx-new",
            status: "confirmed",
        } as never);
    });

    it("unlocks a campaign voucher on a qualifying first purchase", async () => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue({
            id: "campaign-1",
            cafeId: "cafe-target",
            windowStart: new Date(Date.now() - 86_400_000),
            windowEnd: new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(hasPriorPaidPurchase).mockResolvedValue(false);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue(null);

        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({
            proofId: "proof-1",
            idempotencyKey: "k1",
        });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        await chain.getTransactionStatus(submission.transactionId);

        expect(hasPriorPaidPurchase).toHaveBeenCalledWith(
            expect.anything(),
            "user-1",
            "cafe-target",
            expect.objectContaining({
                id: submission.transactionId,
                createdAt: new Date(0),
            }),
        );
        expect(unlockCampaignVoucher).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                campaignId: "campaign-1",
                consumerUserId: "user-1",
                cafeId: "cafe-target",
            }),
        );
    });

    it("orders prior purchases by timestamp and id tie-break", async () => {
        const earlier = new Date("2026-01-01T00:00:00.000Z");
        const later = new Date("2026-01-02T00:00:00.000Z");
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue({
            id: "campaign-1",
            cafeId: "cafe-target",
            windowStart: new Date("2025-01-01T00:00:00.000Z"),
            windowEnd: new Date("2027-01-01T00:00:00.000Z"),
        } as never);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue(null);
        vi.mocked(hasPriorPaidPurchase).mockImplementation(
            async (_client, _userId, _cafeId, current) =>
                current.createdAt > earlier ||
                (current.createdAt.getTime() === earlier.getTime() &&
                    current.id > "tx-a"),
        );
        vi.mocked(findTransactionById).mockImplementation(
            async (id) =>
                ({
                    id,
                    status: "pending",
                    operation: "emission",
                    proofId: "proof-1",
                    createdAt: id === "tx-later" ? later : earlier,
                }) as never,
        );
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        await chain.getTransactionStatus("tx-later");
        await chain.getTransactionStatus("tx-a");
        expect(unlockCampaignVoucher).toHaveBeenCalledTimes(1);
        vi.clearAllMocks();
        vi.mocked(updateTransactionStatus).mockResolvedValue({
            id: "tx-a",
            status: "confirmed",
        } as never);
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue({
            id: "campaign-1",
            cafeId: "cafe-target",
            windowStart: new Date("2025-01-01T00:00:00.000Z"),
            windowEnd: new Date("2027-01-01T00:00:00.000Z"),
        } as never);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue(null);
        vi.mocked(hasPriorPaidPurchase).mockImplementation(
            async (_client, _userId, _cafeId, current) =>
                current.createdAt > earlier ||
                (current.createdAt.getTime() === earlier.getTime() &&
                    current.id > "tx-a"),
        );
        vi.mocked(findTransactionById).mockImplementation(
            async (id) =>
                ({
                    id,
                    status: "pending",
                    operation: "emission",
                    proofId: "proof-1",
                    createdAt: earlier,
                }) as never,
        );
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        await chain.getTransactionStatus("tx-b");
        await chain.getTransactionStatus("tx-a");
        expect(unlockCampaignVoucher).toHaveBeenCalledTimes(1);
    });

    it("increments once when one purchase unlocks campaign and completes crawl", async () => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue({
            id: "campaign-1",
            cafeId: "cafe-target",
            windowStart: new Date(Date.now() - 86_400_000),
            windowEnd: new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(hasPriorPaidPurchase).mockResolvedValue(false);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue({
            id: "crawl-1",
            expiresAt: new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(getCrawlSteps).mockResolvedValue([
            { stepIndex: 0, cafeId: "cafe-target" },
        ] as never);
        vi.mocked(getOrCreateCrawlProgress).mockResolvedValue({
            id: "progress-1",
            completedCafeIds: [],
        } as never);

        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({
            proofId: "proof-1",
            idempotencyKey: "both",
        });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        await chain.getTransactionStatus(submission.transactionId);

        expect(incrementBalance).toHaveBeenCalledTimes(1);
        expect(unlockCampaignVoucher).toHaveBeenCalledTimes(1);
        expect(advanceCrawlProgress).toHaveBeenCalledTimes(1);
        expect(unlockCrawlVoucher).toHaveBeenCalledTimes(1);
        expect(updateTransactionStatus).toHaveBeenCalledTimes(1);
    });

    it("does not unlock when there is no active campaign", async () => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue(null);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue(null);
        await finalizeEmission("campaign-inactive");
        expect(findActiveCampaignForCafe).toHaveBeenCalledWith(
            expect.anything(),
            "cafe-target",
        );
        expect(isEligibleForAcquisitionCampaign).not.toHaveBeenCalled();
        expect(hasPriorPaidPurchase).not.toHaveBeenCalled();
        expect(unlockCampaignVoucher).not.toHaveBeenCalled();
    });

    it("does not unlock an active campaign when purchase is outside its window", async () => {
        const windowStart = new Date(Date.now() + 60_000);
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue({
            id: "campaign-window",
            cafeId: "cafe-target",
            windowStart,
            windowEnd: new Date(Date.now() + 120_000),
        } as never);
        vi.mocked(hasPriorPaidPurchase).mockResolvedValue(false);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue(null);
        await finalizeEmission("campaign-window");
        expect(hasPriorPaidPurchase).toHaveBeenCalledTimes(1);
        const eligibilityInput = vi.mocked(isEligibleForAcquisitionCampaign)
            .mock.calls[0]?.[0];
        expect(eligibilityInput?.hadPriorPaidPurchaseAtCafe).toBe(false);
        expect(eligibilityInput?.purchaseAt.getTime()).toBeLessThan(
            windowStart.getTime(),
        );
        expect(unlockCampaignVoucher).not.toHaveBeenCalled();
    });

    it("does not unlock an in-window campaign after a prior purchase", async () => {
        const windowStart = new Date(Date.now() - 60_000);
        const windowEnd = new Date(Date.now() + 60_000);
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue({
            id: "campaign-prior",
            cafeId: "cafe-target",
            windowStart,
            windowEnd,
        } as never);
        vi.mocked(hasPriorPaidPurchase).mockResolvedValue(true);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue(null);
        await finalizeEmission("campaign-prior");
        expect(hasPriorPaidPurchase).toHaveBeenCalledTimes(1);
        const eligibilityInput = vi.mocked(isEligibleForAcquisitionCampaign)
            .mock.calls[0]?.[0];
        expect(eligibilityInput?.hadPriorPaidPurchaseAtCafe).toBe(true);
        expect(eligibilityInput?.purchaseAt.getTime()).toBeGreaterThanOrEqual(
            windowStart.getTime(),
        );
        expect(eligibilityInput?.purchaseAt.getTime()).toBeLessThanOrEqual(
            windowEnd.getTime(),
        );
        expect(unlockCampaignVoucher).not.toHaveBeenCalled();
    });

    it.each([
        "expired",
        "wrong next step",
        "already completed",
    ])("does not advance or unlock an %s crawl", async (caseName) => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue(null);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue({
            id: "crawl-1",
            expiresAt:
                caseName === "expired"
                    ? new Date(Date.now() - 1)
                    : new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(getCrawlSteps).mockResolvedValue([
            {
                stepIndex: 0,
                cafeId:
                    caseName === "wrong next step" ? "other" : "cafe-target",
            },
        ] as never);
        vi.mocked(getOrCreateCrawlProgress).mockResolvedValue({
            id: "progress-1",
            completedCafeIds:
                caseName === "already completed" ? ["cafe-target"] : [],
        } as never);
        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({
            proofId: "proof-1",
            idempotencyKey: `crawl-${caseName}`,
        });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        await chain.getTransactionStatus(submission.transactionId);
        expect(advanceCrawlProgress).not.toHaveBeenCalled();
        expect(unlockCrawlVoucher).not.toHaveBeenCalled();
    });

    it("does no writes when polling an already confirmed transaction", async () => {
        const pending = {
            id: "tx-poll",
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never;
        vi.mocked(findTransactionById)
            .mockResolvedValueOnce(pending)
            .mockResolvedValueOnce(pending)
            .mockResolvedValue({ id: "tx-poll", status: "confirmed" } as never);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        const chain = new PostgresMockConsumerChain(() => 750, 0);
        await chain.getTransactionStatus("tx-poll");
        await chain.getTransactionStatus("tx-poll");
        expect(incrementBalance).toHaveBeenCalledTimes(1);
        expect(advanceCrawlProgress).not.toHaveBeenCalled();
        expect(unlockCampaignVoucher).not.toHaveBeenCalled();
        expect(unlockCrawlVoucher).not.toHaveBeenCalled();
        expect(updateTransactionStatus).toHaveBeenCalledTimes(1);
    });

    it("confirms when a unique voucher unlock is already present", async () => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue({
            id: "campaign-1",
            cafeId: "cafe-target",
            windowStart: new Date(Date.now() - 86_400_000),
            windowEnd: new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(hasPriorPaidPurchase).mockResolvedValue(false);
        vi.mocked(unlockCampaignVoucher).mockResolvedValue(null);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue(null);
        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({
            proofId: "proof-1",
            idempotencyKey: "unique",
        });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        await expect(
            chain.getTransactionStatus(submission.transactionId),
        ).resolves.toMatchObject({ status: "confirmed" });
        expect(updateTransactionStatus).toHaveBeenCalledTimes(1);
    });

    it("does not confirm when campaign evaluation fails", async () => {
        vi.mocked(findActiveCampaignForCafe).mockRejectedValue(
            new Error("db unavailable"),
        );
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue(null);
        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({
            proofId: "proof-1",
            idempotencyKey: "failure",
        });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        await expect(
            chain.getTransactionStatus(submission.transactionId),
        ).rejects.toThrow("db unavailable");
        expect(updateTransactionStatus).not.toHaveBeenCalled();
    });

    it("advances the crawl step matching this café", async () => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue(null);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue({
            id: "crawl-1",
            expiresAt: new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(getCrawlSteps).mockResolvedValue([
            { stepIndex: 0, cafeId: "cafe-a" },
            { stepIndex: 1, cafeId: "cafe-target" },
            { stepIndex: 2, cafeId: "cafe-c" },
        ] as never);
        vi.mocked(getOrCreateCrawlProgress).mockResolvedValue({
            id: "progress-1",
            completedCafeIds: ["cafe-a"],
        } as never);

        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({
            proofId: "proof-1",
            idempotencyKey: "k2",
        });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        await chain.getTransactionStatus(submission.transactionId);

        expect(advanceCrawlProgress).toHaveBeenCalledWith(
            expect.anything(),
            "progress-1",
            ["cafe-a", "cafe-target"],
            false,
        );
        expect(unlockCrawlVoucher).not.toHaveBeenCalled();
    });

    it("unlocks the crawl voucher when the final step completes", async () => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue(null);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue({
            id: "crawl-1",
            expiresAt: new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(getCrawlSteps).mockResolvedValue([
            { stepIndex: 0, cafeId: "cafe-a" },
            { stepIndex: 1, cafeId: "cafe-b" },
            { stepIndex: 2, cafeId: "cafe-target" },
        ] as never);
        vi.mocked(getOrCreateCrawlProgress).mockResolvedValue({
            id: "progress-1",
            completedCafeIds: ["cafe-a", "cafe-b"],
        } as never);

        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({
            proofId: "proof-1",
            idempotencyKey: "k3",
        });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
        } as never);
        await chain.getTransactionStatus(submission.transactionId);

        expect(advanceCrawlProgress).toHaveBeenCalledWith(
            expect.anything(),
            "progress-1",
            ["cafe-a", "cafe-b", "cafe-target"],
            true,
        );
        expect(unlockCrawlVoucher).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                crawlId: "crawl-1",
                consumerUserId: "user-1",
            }),
        );
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

    it("finalizes once after the confirmation delay", async () => {
        const createdAt = new Date(0);
        vi.mocked(findTransactionById)
            .mockResolvedValueOnce({
                id: "tx-pending",
                status: "pending",
                createdAt,
                operation: "emission",
                proofId: "proof-1",
            } as never)
            .mockResolvedValueOnce({
                id: "tx-pending",
                status: "pending",
                operation: "emission",
                proofId: "proof-1",
            } as never);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            consumerUserId: "user-1",
        } as never);
        vi.mocked(incrementBalance).mockResolvedValue(1);
        vi.mocked(updateTransactionStatus).mockResolvedValue({
            id: "tx-pending",
            status: "confirmed",
        } as never);
        await expect(
            new PostgresMockConsumerChain(() => 750).getTransactionStatus(
                "tx-pending",
            ),
        ).resolves.toEqual({
            transactionId: "tx-pending",
            status: "confirmed",
        });
        expect(incrementBalance).toHaveBeenCalledWith(
            expect.anything(),
            "user-1",
            1,
        );
        expect(updateTransactionStatus).toHaveBeenCalledWith(
            expect.anything(),
            "tx-pending",
            "confirmed",
        );
    });

    it("throws TRANSACTION_NOT_FOUND for an unknown id", async () => {
        vi.mocked(findTransactionById).mockResolvedValue(null);
        const chain = new PostgresMockConsumerChain();
        await expect(chain.getTransactionStatus("missing")).rejects.toThrow(
            ConsumerChainError,
        );
    });
});
