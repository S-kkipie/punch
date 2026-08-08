import { describe, expect, it } from "vitest";
import { immediateTransactionState } from "../page";

describe("purchase confirmation immediate state", () => {
    it("renders the pending state before the first status poll", () => {
        expect(immediateTransactionState({})).toEqual({ status: "pending" });
    });

    it("preserves a returned rejection so retry remains available", () => {
        expect(
            immediateTransactionState({
                status: "rejected",
                rejectionReason: "Compra ya confirmada",
            }),
        ).toEqual({
            status: "rejected",
            rejectionReason: "Compra ya confirmada",
        });
    });
});
