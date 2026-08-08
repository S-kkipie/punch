import { describe, expect, it } from "vitest";
import {
    confirmPurchaseSchema,
    createPurchaseProofSchema,
    purchaseProofSchema,
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
});

describe("confirmPurchaseSchema", () => {
    it("requires only a proofId", () => {
        expect(() =>
            confirmPurchaseSchema.parse({ proofId: "proof-1" }),
        ).not.toThrow();
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
