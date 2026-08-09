import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/proofs", () => ({
    findProofById: vi.fn(),
    expireQuote: vi.fn(),
}));
vi.mock("@/server/auth/membership/require-cafe-role", () => ({
    requireCafeRole: vi.fn(),
}));

import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
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

    it("rejects an unrelated authenticated user from a bound quote", async () => {
        vi.mocked(findProofById).mockResolvedValue({
            id: "quote-1",
            cafeId: "cafe-1",
            productId: "product-1",
            amountCentimos: 800,
            expiresAt: new Date(Date.now() + 60_000),
            status: "submitted",
            yapeRef: "YAPE-1234",
            issuedByUserId: "barista-1",
            consumerUserId: "consumer-1",
            purchaseOrderId: "order-1",
            receiptHash: null,
            nonce: null,
            cafeSignature: null,
            consumerSignature: null,
            failureReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        } as never);
        vi.mocked(requireCafeRole).mockResolvedValue({
            ok: false,
            error: { type: "ForbiddenError", code: "FORBIDDEN", status: 403 },
        } as never);
        const result = await getPurchaseQuoteService("intruder", "quote-1");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.status).toBe(403);
        expect(requireCafeRole).toHaveBeenCalledWith("intruder", "cafe-1", [
            "owner",
            "barista",
        ]);
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

    it("re-reads the quote when expiring loses a confirmation race", async () => {
        const submittedRow = {
            id: "quote-1",
            cafeId: "cafe-1",
            productId: "product-1",
            amountCentimos: 800,
            expiresAt: new Date(Date.now() - 1),
            status: "submitted",
            yapeRef: "YAPE-1234",
            issuedByUserId: "barista-1",
            consumerUserId: "consumer-1",
            purchaseOrderId: "order-1",
            receiptHash: null,
            nonce: null,
            cafeSignature: null,
            consumerSignature: null,
            failureReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        vi.mocked(findProofById)
            .mockResolvedValueOnce({
                ...submittedRow,
                status: "issued",
                consumerUserId: null,
                purchaseOrderId: null,
            } as never)
            .mockResolvedValueOnce(submittedRow as never);
        vi.mocked(expireQuote).mockResolvedValue(null);

        const result = await getPurchaseQuoteService("consumer-1", "quote-1");

        expect(findProofById).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            ok: true,
            data: { status: "submitted", purchaseOrderId: "order-1" },
        });
    });
});
