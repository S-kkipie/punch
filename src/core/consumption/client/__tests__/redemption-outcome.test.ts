import { describe, expect, it } from "vitest";

import { readRedemptionOutcome } from "../redemption-outcome";

describe("readRedemptionOutcome", () => {
    it("reads a created request out of the wrapped response", () => {
        expect(
            readRedemptionOutcome(
                { response: { id: "req-1", status: "pending" } },
                null,
            ),
        ).toEqual({ kind: "requested", id: "req-1", status: "pending" });
    });

    it("reads a created request that arrives unwrapped", () => {
        expect(
            readRedemptionOutcome({ id: "req-2", status: "approved" }, null),
        ).toEqual({ kind: "requested", id: "req-2", status: "approved" });
    });

    it("recognises the active-request conflict from the error", () => {
        expect(
            readRedemptionOutcome(null, {
                value: { code: "CONFLICT", status: 409, targets: ["request"] },
            }),
        ).toEqual({ kind: "conflict" });
    });

    it("recognises the conflict when it arrives as the response body", () => {
        expect(
            readRedemptionOutcome(
                { code: "CONFLICT", status: 409, targets: ["request"] },
                null,
            ),
        ).toEqual({ kind: "conflict" });
    });

    it("keeps the server's explanation on other failures", () => {
        expect(
            readRedemptionOutcome(null, {
                value: {
                    code: "UNPROCESSABLE_ENTITY",
                    status: 422,
                    cause: "Necesitas 12 PUNCH para canjear.",
                },
            }),
        ).toEqual({
            kind: "error",
            message: "Necesitas 12 PUNCH para canjear.",
        });
    });

    it("falls back to a generic message when the server gives no cause", () => {
        const outcome = readRedemptionOutcome(null, { value: { status: 500 } });
        expect(outcome?.kind).toBe("error");
    });

    it("handles a thrown Error", () => {
        expect(readRedemptionOutcome(null, new Error("Sin conexión"))).toEqual({
            kind: "error",
            message: "Sin conexión",
        });
    });

    it("returns null before anything happened", () => {
        expect(readRedemptionOutcome(undefined, null)).toBeNull();
    });
});
