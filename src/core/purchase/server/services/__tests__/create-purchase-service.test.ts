import { describe, expect, it, vi } from "vitest";
import { createPurchaseService } from "../create-purchase-service";

function deps(overrides: Record<string, unknown> = {}) {
    return {
        findApprovedCafe: vi.fn().mockResolvedValue({
            id: "cafe-1",
            chainCafeId: 1,
        }),
        findEmissionProduct: vi.fn().mockResolvedValue({
            id: "prod-1",
            cafeId: "cafe-1",
            type: "emission",
            approvalStatus: "approved",
            chainProductId: 1,
            active: true,
        }),
        ensureWallet: vi.fn().mockResolvedValue({
            walletIndex: 5,
            address: "0xAb000000000000000000000000000000000000cd",
        }),
        insertOrder: vi.fn().mockImplementation(async (row) => ({
            id: "order-1",
            ...row,
            createdAt: new Date("2026-08-08T12:00:00.000Z"),
        })),
        ...overrides,
    };
}

describe("createPurchaseService", () => {
    it("creates a user_confirmed order with proof fields", async () => {
        const d = deps();
        const result = await createPurchaseService(
            "user-1",
            {
                cafeId: "cafe-1",
                productId: "prod-1",
                amountSoles: 8.5,
                yapeRef: "op-123",
            },
            d,
        );

        expect(result.ok).toBe(true);
        const inserted = d.insertOrder.mock.calls[0][0];
        expect(inserted.amount).toBe(8_500_000n);
        expect(inserted.status).toBe("user_confirmed");
        expect(BigInt(inserted.nonce)).toBeGreaterThan(0n);
        expect(inserted.receiptHash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(inserted.expiry.getTime()).toBeGreaterThan(Date.now());
    });

    it("rejects amounts under the 8 mPEN minimum ticket", async () => {
        const result = await createPurchaseService(
            "user-1",
            {
                cafeId: "cafe-1",
                productId: "prod-1",
                amountSoles: 5,
                yapeRef: "op-123",
            },
            deps(),
        );

        expect(result.ok).toBe(false);
    });

    it("rejects a product belonging to another café", async () => {
        const d = deps({
            findEmissionProduct: vi.fn().mockResolvedValue({
                id: "prod-1",
                cafeId: "cafe-2",
                type: "emission",
                approvalStatus: "approved",
                chainProductId: 1,
                active: true,
            }),
        });

        const result = await createPurchaseService(
            "user-1",
            {
                cafeId: "cafe-1",
                productId: "prod-1",
                amountSoles: 8,
                yapeRef: "op-123",
            },
            d,
        );

        expect(result.ok).toBe(false);
        expect(d.insertOrder).not.toHaveBeenCalled();
    });

    it("rejects an unapproved café or missing chain mapping", async () => {
        for (const cafe of [
            { id: "cafe-1", chainCafeId: null },
            { id: "cafe-1", chainCafeId: 1, onboardingStatus: "submitted" },
        ]) {
            const d = deps({
                findApprovedCafe: vi.fn().mockResolvedValue(cafe),
            });
            const result = await createPurchaseService(
                "user-1",
                {
                    cafeId: "cafe-1",
                    productId: "prod-1",
                    amountSoles: 8,
                    yapeRef: "op-123",
                },
                d,
            );
            expect(result.ok).toBe(false);
        }
    });

    it("rejects an inactive emission product", async () => {
        const d = deps({
            findEmissionProduct: vi.fn().mockResolvedValue({
                id: "prod-1",
                cafeId: "cafe-1",
                type: "emission",
                approvalStatus: "approved",
                chainProductId: 1,
                active: false,
            }),
        });
        const result = await createPurchaseService(
            "user-1",
            {
                cafeId: "cafe-1",
                productId: "prod-1",
                amountSoles: 8,
                yapeRef: "op-123",
            },
            d,
        );
        expect(result.ok).toBe(false);
        expect(d.insertOrder).not.toHaveBeenCalled();
    });

    it("rejects an unapproved emission product or missing chain mapping", async () => {
        for (const product of [
            {
                id: "prod-1",
                cafeId: "cafe-1",
                type: "reward",
                approvalStatus: "approved",
                chainProductId: 1,
                active: true,
            },
            {
                id: "prod-1",
                cafeId: "cafe-1",
                type: "emission",
                approvalStatus: "pending",
                chainProductId: 1,
                active: true,
            },
            {
                id: "prod-1",
                cafeId: "cafe-1",
                type: "emission",
                approvalStatus: "approved",
                chainProductId: null,
            },
        ]) {
            const d = deps({
                findEmissionProduct: vi.fn().mockResolvedValue(product),
            });
            const result = await createPurchaseService(
                "user-1",
                {
                    cafeId: "cafe-1",
                    productId: "prod-1",
                    amountSoles: 8,
                    yapeRef: "op-123",
                },
                d,
            );
            expect(result.ok).toBe(false);
        }
    });
});
