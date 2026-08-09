import { describe, expect, it, vi } from "vitest";
import { buildReceiptHash } from "@/core/chain/server/proof/proof";
import { AppErrors } from "@/server/common/responses";
import { confirmQuoteService } from "../confirm-quote-service";

const now = new Date("2026-08-09T12:00:00.000Z");
const quoteExpiresAt = new Date("2026-08-09T12:09:00.000Z");
const quoteCreatedAt = new Date("2026-08-09T11:55:00.000Z");
const consumerWallet = {
    walletIndex: 7,
    address: "0x1000000000000000000000000000000000000007" as const,
};
const issuingOperatorWallet = {
    walletIndex: 11,
    walletAddress: "0x1000000000000000000000000000000000000011" as const,
};
const quote = {
    id: "quote-1",
    cafeId: "cafe-1",
    productId: "product-1",
    issuedByUserId: "barista-1",
    consumerUserId: null,
    amountCentimos: 1200,
    yapeRef: "YAPE-9988",
    receiptHash: null,
    nonce: null,
    cafeSignature: null,
    consumerSignature: null,
    failureReason: null,
    purchaseOrderId: null,
    status: "issued" as const,
    expiresAt: quoteExpiresAt,
    createdAt: quoteCreatedAt,
    updatedAt: quoteCreatedAt,
    chainCafeId: 77,
    chainProductId: 88,
};
const bridgedOrder = {
    id: "order-1",
    cafeId: quote.cafeId,
    productId: quote.productId,
    amountSoles: 12,
    status: "queued" as const,
    failureReason: null,
    txHash: null,
    expiry: quoteExpiresAt.toISOString(),
    createdAt: now.toISOString(),
};
const bridgedQuote = {
    id: quote.id,
    cafeId: quote.cafeId,
    productId: quote.productId,
    amountCentimos: quote.amountCentimos,
    expiresAt: quoteExpiresAt.toISOString(),
    status: "submitted" as const,
    maskedYapeRef: "••••••••88",
    purchaseOrderId: bridgedOrder.id,
    failureReason: null,
    createdAt: quoteCreatedAt.toISOString(),
};

function deps(overrides: Record<string, unknown> = {}) {
    return {
        now: vi.fn(() => now),
        generateOrderId: vi.fn(() => "order-1"),
        randomNonce: vi.fn(() => 123456789n),
        signProof: vi
            .fn()
            .mockResolvedValueOnce("0xconsumer-signature")
            .mockResolvedValueOnce("0xcafe-signature"),
        findQuote: vi.fn().mockResolvedValue(quote),
        findExistingBridge: vi.fn(),
        requireCafeRole: vi
            .fn()
            .mockResolvedValue({ ok: true, data: { role: "barista" } }),
        isAuthorizedCafeOperator: vi.fn().mockResolvedValue(true),
        ensureWallet: vi.fn().mockResolvedValue(consumerWallet),
        findUserWallet: vi.fn().mockResolvedValue(issuingOperatorWallet),
        bridgeQuoteToOrder: vi.fn().mockResolvedValue({
            order: bridgedOrder,
            quote: bridgedQuote,
            outcome: "created",
        }),
        ...overrides,
    };
}

describe("confirmQuoteService", () => {
    it("builds one exact proof and signs it with the consumer and issuing operator wallets", async () => {
        const d = deps();

        const result = await confirmQuoteService("consumer-1", "quote-1", d);

        expect(result).toEqual({
            ok: true,
            data: {
                order: bridgedOrder,
                quote: bridgedQuote,
                outcome: "created",
            },
        });
        const expectedProof = {
            cafeId: 77n,
            user: consumerWallet.address,
            productId: 88n,
            amount: 12_000_000n,
            receiptHash: buildReceiptHash("order-1", quote.yapeRef),
            nonce: 123456789n,
            expiry: BigInt(Math.floor(quoteExpiresAt.getTime() / 1000)),
        };
        expect(d.signProof).toHaveBeenNthCalledWith(
            1,
            consumerWallet.walletIndex,
            expectedProof,
        );
        expect(d.signProof).toHaveBeenNthCalledWith(
            2,
            issuingOperatorWallet.walletIndex,
            expectedProof,
        );
        expect(expectedProof).toMatchObject({
            cafeId: BigInt(quote.chainCafeId),
            user: consumerWallet.address,
            productId: BigInt(quote.chainProductId),
            amount: BigInt(quote.amountCentimos) * 10_000n,
            receiptHash: buildReceiptHash("order-1", quote.yapeRef),
        });
        expect(expectedProof.expiry).toBeLessThanOrEqual(
            BigInt(Math.floor(quote.expiresAt.getTime() / 1000)),
        );
        expect(d.bridgeQuoteToOrder).toHaveBeenCalledWith({
            quoteId: quote.id,
            consumerUserId: "consumer-1",
            now,
            orderId: "order-1",
            proof: expectedProof,
            cafeSignature: "0xcafe-signature",
            userSignature: "0xconsumer-signature",
        });
    });

    it("returns the existing bridge without resigning when the quote is already linked to an order", async () => {
        const d = deps({
            findQuote: vi.fn().mockResolvedValue({
                ...quote,
                status: "submitted",
                consumerUserId: "consumer-1",
                purchaseOrderId: "order-1",
            }),
            findExistingBridge: vi.fn().mockResolvedValue({
                order: bridgedOrder,
                quote: { ...bridgedQuote, status: "submitted" },
                outcome: "existing",
            }),
        });

        const result = await confirmQuoteService("consumer-1", "quote-1", d);

        expect(result).toEqual({
            ok: true,
            data: {
                order: bridgedOrder,
                quote: { ...bridgedQuote, status: "submitted" },
                outcome: "existing",
            },
        });
        expect(d.signProof).not.toHaveBeenCalled();
        expect(d.bridgeQuoteToOrder).not.toHaveBeenCalled();
    });

    it("rejects invalid quote states before repository mutation", async () => {
        const cases = [
            {
                name: "expired quote",
                row: { ...quote, expiresAt: new Date(now.getTime() - 1) },
                expectedError: AppErrors.conflict({ targets: ["status"] }),
            },
            {
                name: "wrong consumer",
                row: { ...quote, consumerUserId: "someone-else" },
                expectedError: AppErrors.forbidden(),
            },
            {
                name: "missing cafe mapping",
                row: { ...quote, chainCafeId: null },
                expectedError: AppErrors.unprocessableEntity({
                    targets: ["chainMapping"],
                }),
            },
            {
                name: "missing product mapping",
                row: { ...quote, chainProductId: null },
                expectedError: AppErrors.unprocessableEntity({
                    targets: ["chainMapping"],
                }),
            },
        ];

        for (const testCase of cases) {
            const d = deps({
                findQuote: vi.fn().mockResolvedValue(testCase.row),
            });
            const result = await confirmQuoteService("consumer-1", quote.id, d);
            expect(result).toEqual({
                ok: false,
                error: testCase.expectedError,
            });
            expect(d.requireCafeRole).not.toHaveBeenCalled();
            expect(d.isAuthorizedCafeOperator).not.toHaveBeenCalled();
            expect(d.bridgeQuoteToOrder).not.toHaveBeenCalled();
        }
    });

    it("rejects when the issuing operator is no longer a cafe member", async () => {
        const d = deps({
            requireCafeRole: vi.fn().mockResolvedValue({
                ok: false,
                error: AppErrors.forbidden(),
            }),
        });

        const result = await confirmQuoteService("consumer-1", quote.id, d);

        expect(result).toEqual({
            ok: false,
            error: AppErrors.unprocessableEntity({ targets: ["operator"] }),
        });
        expect(d.findUserWallet).not.toHaveBeenCalled();
        expect(d.bridgeQuoteToOrder).not.toHaveBeenCalled();
    });

    it("rejects when the issuing operator is no longer authorized", async () => {
        const d = deps({
            isAuthorizedCafeOperator: vi.fn().mockResolvedValue(false),
        });

        const result = await confirmQuoteService("consumer-1", quote.id, d);

        expect(result).toEqual({
            ok: false,
            error: AppErrors.unprocessableEntity({ targets: ["operator"] }),
        });
        expect(d.ensureWallet).toHaveBeenCalledWith("consumer-1");
        expect(d.bridgeQuoteToOrder).not.toHaveBeenCalled();
    });

    it("uses one operator wallet lookup for authorization and signing", async () => {
        const d = deps();

        const result = await confirmQuoteService("consumer-1", quote.id, d);

        expect(result.ok).toBe(true);
        expect(d.findUserWallet).toHaveBeenCalledTimes(1);
        expect(d.isAuthorizedCafeOperator).toHaveBeenCalledWith({
            chainCafeId: quote.chainCafeId,
            walletAddress: issuingOperatorWallet.walletAddress,
        });
    });

    it("starts both signatures against the same proof before either resolves", async () => {
        const releases: Array<() => void> = [];
        const started: number[] = [];
        const d = deps({
            signProof: vi.fn((walletIndex: number) => {
                started.push(walletIndex);
                return new Promise<`0x${string}`>((resolve) => {
                    releases.push(() =>
                        resolve(
                            walletIndex === consumerWallet.walletIndex
                                ? "0xconsumer-signature"
                                : "0xcafe-signature",
                        ),
                    );
                });
            }),
        });

        const pending = confirmQuoteService("consumer-1", quote.id, d);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(started).toEqual([
            consumerWallet.walletIndex,
            issuingOperatorWallet.walletIndex,
        ]);
        expect(releases).toHaveLength(2);
        for (const release of releases) release();
        await expect(pending).resolves.toMatchObject({ ok: true });
    });

    it("rejects when the issuing operator wallet mapping is missing", async () => {
        const d = deps({
            findUserWallet: vi.fn().mockResolvedValue({
                walletIndex: null,
                walletAddress: null,
            }),
        });

        const result = await confirmQuoteService("consumer-1", quote.id, d);

        expect(result).toEqual({
            ok: false,
            error: AppErrors.unprocessableEntity({ targets: ["wallet"] }),
        });
        expect(d.signProof).not.toHaveBeenCalled();
        expect(d.bridgeQuoteToOrder).not.toHaveBeenCalled();
    });
});
