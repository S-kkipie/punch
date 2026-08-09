import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/proofs", () => ({
    findProofById: vi.fn(),
    expireQuote: vi.fn(),
}));

import { expireQuote, findProofById } from "../../repository/proofs";
import { getPurchaseQuoteService } from "../get-purchase-quote-service";

describe("getPurchaseQuoteService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns only safe quote fields and masks the Yape reference", async () => {
        vi.mocked(findProofById).mockResolvedValue({
            id: "quote-1",
            cafeId: "cafe-1",
            productId: "product-1",
            amountCentimos: 800,
            expiresAt: new Date(Date.now() + 60_000),
            status: "issued",
            yapeRef: "YAPE-1234",
            issuedByUserId: "barista-1",
            consumerUserId: null,
            purchaseOrderId: null,
            receiptHash: null,
            nonce: null,
            cafeSignature: null,
            consumerSignature: null,
            failureReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        } as never);
        const result = await getPurchaseQuoteService("consumer-1", "quote-1");
        expect(result).toMatchObject({
            ok: true,
            data: {
                id: "quote-1",
                status: "issued",
                maskedYapeRef: "•••••••34",
                purchaseOrderId: null,
            },
        });
        expect(JSON.stringify(result)).not.toContain("YAPE-1234");
    });

    it("expires a stale issued quote before returning it", async () => {
        vi.mocked(findProofById).mockResolvedValue({
            id: "quote-1",
            cafeId: "cafe-1",
            productId: "product-1",
            amountCentimos: 800,
            expiresAt: new Date(Date.now() - 1),
            status: "issued",
            yapeRef: "YAPE-1234",
            issuedByUserId: "barista-1",
            consumerUserId: null,
            purchaseOrderId: null,
            receiptHash: null,
            nonce: null,
            cafeSignature: null,
            consumerSignature: null,
            failureReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        } as never);
        vi.mocked(expireQuote).mockResolvedValue({
            status: "expired",
        } as never);
        const result = await getPurchaseQuoteService("consumer-1", "quote-1");
        expect(expireQuote).toHaveBeenCalledWith("quote-1");
        expect(result).toMatchObject({ ok: true, data: { status: "expired" } });
    });
});
