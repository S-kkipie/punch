import { describe, expect, it } from "vitest";
import {
    purchaseOrderQueryKey,
    purchaseQuoteQueryKey,
    purchaseStatusCopy,
    toUiPurchaseState,
} from "../purchase-status";

describe("purchase status mapping", () => {
    it.each([
        ["issued", undefined, "issued"],
        ["issued", "queued", "queued"],
        ["submitted", "queued", "queued"],
        ["submitted", "submitted", "submitted"],
        ["submitted", "confirmed", "confirmed"],
        ["submitted", "failed", "failed"],
        ["submitted", "expired", "expired"],
        ["confirmed", undefined, "confirmed"],
        ["failed", undefined, "failed"],
        ["expired", undefined, "expired"],
    ] as const)("maps %s/%s to %s", (quoteStatus, orderStatus, expected) => {
        expect(toUiPurchaseState({ quoteStatus, orderStatus })).toBe(expected);
    });

    it("provides Spanish copy for every user-facing purchase state", () => {
        expect(purchaseStatusCopy("expired")).toEqual({
            label: "Código vencido",
            hint: "Pide al barista uno nuevo.",
        });
        for (const status of [
            "issued",
            "queued",
            "submitted",
            "confirmed",
            "failed",
            "expired",
        ] as const) {
            const copy = purchaseStatusCopy(status);
            expect(copy.label).not.toMatch(
                /\b(wallet|gas|firma|dirección|red)\b/i,
            );
            expect(copy.hint).not.toMatch(
                /\b(wallet|gas|firma|dirección|red)\b/i,
            );
        }
    });

    it("uses stable cache keys", () => {
        expect(purchaseQuoteQueryKey("quote-1")).toEqual([
            "consumption",
            "quote",
            "quote-1",
        ]);
        expect(purchaseOrderQueryKey("order-1")).toEqual([
            "purchase",
            "order",
            "order-1",
        ]);
    });
});
