import { describe, expect, it } from "vitest";
import {
    confirmPurchaseSchema,
    createPurchaseProofSchema,
    purchaseProofSchema,
    requestVoucherRedemptionSchema,
} from "../schemas";

describe("createPurchaseProofSchema", () => {
    it("requires a productId and a receiptHash", () => {
        expect(() =>
            createPurchaseProofSchema.parse({
                productId: "p1",
                receiptHash: `0x${"ab".repeat(32)}`,
            }),
        ).not.toThrow();
    });
    it("rejects a malformed receiptHash", () => {
        expect(() =>
            createPurchaseProofSchema.parse({
                productId: "p1",
                receiptHash: "not-a-hash",
            }),
        ).toThrow();
    });
    it("explains how to provide a product", () => {
        const result = createPurchaseProofSchema.safeParse({
            productId: "",
            receiptHash: `0x${"ab".repeat(32)}`,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toBe(
                "Selecciona un producto",
            );
        }
    });
});

describe("confirmPurchaseSchema", () => {
    it("requires only a proofId", () => {
        expect(() =>
            confirmPurchaseSchema.parse({ proofId: "proof-1" }),
        ).not.toThrow();
    });
    it("explains how to provide a proof", () => {
        const result = confirmPurchaseSchema.safeParse({ proofId: "" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toBe(
                "Indica el comprobante de compra",
            );
        }
    });
});

describe("requestVoucherRedemptionSchema", () => {
    it("explains how to provide a voucher", () => {
        const result = requestVoucherRedemptionSchema.safeParse({
            voucherId: "",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toBe(
                "Indica el voucher a canjear",
            );
        }
    });
});

describe("purchaseProofSchema", () => {
    it("parses the public wire shape", () => {
        expect(() =>
            purchaseProofSchema.parse({
                id: "proof-1",
                cafeId: "cafe-1",
                productId: "product-1",
                amountCentimos: 800,
                expiresAt: new Date().toISOString(),
                status: "issued",
                createdAt: new Date().toISOString(),
            }),
        ).not.toThrow();
    });
});
