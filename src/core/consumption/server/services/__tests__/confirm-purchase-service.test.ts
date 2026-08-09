import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/purchase/server/services/confirm-quote-service", () => ({
    confirmQuoteService: vi.fn(),
}));

import { confirmQuoteService } from "@/core/purchase/server/services/confirm-quote-service";
import { err, ok } from "@/server/common/responses";
import { confirmPurchaseService } from "../confirm-purchase-service";

const bridgeResult = {
    order: {
        id: "order-1",
        cafeId: "cafe-1",
        productId: "product-1",
        amountSoles: 12,
        status: "queued" as const,
        failureReason: null,
        txHash: null,
        expiry: "2026-08-09T12:09:00.000Z",
        createdAt: "2026-08-09T12:00:00.000Z",
    },
    quote: {
        id: "quote-1",
        cafeId: "cafe-1",
        productId: "product-1",
        amountCentimos: 1200,
        expiresAt: "2026-08-09T12:09:00.000Z",
        status: "submitted" as const,
        maskedYapeRef: "••••88",
        purchaseOrderId: "order-1",
        failureReason: null,
        createdAt: "2026-08-09T11:59:00.000Z",
    },
    outcome: "created" as const,
};

describe("confirmPurchaseService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("delegates purchase confirmation to the quote bridge", async () => {
        vi.mocked(confirmQuoteService).mockResolvedValue(ok(bridgeResult));

        const result = await confirmPurchaseService("user-1", {
            proofId: "quote-1",
        });

        expect(result).toEqual({ ok: true, data: bridgeResult });
        expect(confirmQuoteService).toHaveBeenCalledWith("user-1", "quote-1");
    });

    it("never uses the legacy mock confirmation write path", async () => {
        vi.mocked(confirmQuoteService).mockResolvedValue(
            err({
                type: "ConflictError",
                code: "CONFLICT",
                status: 409,
                targets: ["status"],
            }),
        );

        const result = await confirmPurchaseService("user-1", {
            proofId: "quote-1",
        });

        expect(result).toEqual({
            ok: false,
            error: {
                type: "ConflictError",
                code: "CONFLICT",
                status: 409,
                targets: ["status"],
            },
        });
        expect(confirmQuoteService).toHaveBeenCalledTimes(1);
    });
});
