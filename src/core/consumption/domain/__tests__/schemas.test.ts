import { describe, expect, it } from "vitest";
import { maskYapeRef } from "../quotes";
import {
    confirmPurchaseSchema,
    createPurchaseProofSchema,
    purchaseProofSchema,
    requestVoucherRedemptionSchema,
} from "../schemas";

describe("createPurchaseProofSchema", () => {
    it("accepts a product and server-side Yape reference", () => {
        expect(
            createPurchaseProofSchema.parse({
                productId: "550e8400-e29b-41d4-a716-446655440000",
                yapeRef: "YAPE-1234",
            }),
        ).toEqual({
            productId: "550e8400-e29b-41d4-a716-446655440000",
            yapeRef: "YAPE-1234",
        });
    });
    it("rejects a Yape reference shorter than four characters", () => {
        expect(() =>
            createPurchaseProofSchema.parse({
                productId: "550e8400-e29b-41d4-a716-446655440000",
                yapeRef: "123",
            }),
        ).toThrow();
    });
});

describe("maskYapeRef", () => {
    it.each([
        ["1234", "••34"],
        ["YAPE-987654", "•••••••••54"],
    ])("masks every Yape reference except its final two characters", (raw, masked) => {
        expect(maskYapeRef(raw)).toBe(masked);
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
                maskedYapeRef: "••34",
                purchaseOrderId: null,
                failureReason: null,
                createdAt: new Date().toISOString(),
            }),
        ).not.toThrow();
    });
});
