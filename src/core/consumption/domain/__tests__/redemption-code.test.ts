import { describe, expect, it } from "vitest";

import { redemptionCode } from "../redemption-code";

describe("redemptionCode", () => {
    it("derives a readable code from the request id", () => {
        expect(redemptionCode("8611b813-9a5e-4f0f-9cd4-d7e526e0120c")).toBe(
            "861-1B8",
        );
    });

    it("gives different codes to different requests", () => {
        expect(redemptionCode("a1b2c3d4-0000-0000-0000-000000000000")).not.toBe(
            redemptionCode("f9e8d7c6-0000-0000-0000-000000000000"),
        );
    });

    it("is stable for the same request", () => {
        const id = "8611b813-9a5e-4f0f-9cd4-d7e526e0120c";
        expect(redemptionCode(id)).toBe(redemptionCode(id));
    });

    it("returns what it has when the id is shorter than a code", () => {
        expect(redemptionCode("ab-1")).toBe("AB1");
    });
});
