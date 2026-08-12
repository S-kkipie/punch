import { describe, expect, it } from "vitest";

import { revertMessage } from "../revert-copy";

describe("revertMessage", () => {
    it("explains what to do about a known revert", () => {
        expect(revertMessage("expiry_in_past")).toContain(
            "fecha de fin futura",
        );
        expect(revertMessage("insufficient_budget")).toContain(
            "Financia lo que falta",
        );
    });

    it("returns nothing when there is no error", () => {
        expect(revertMessage(null)).toBeNull();
        expect(revertMessage("")).toBeNull();
    });

    it("shows an unmapped code as-is rather than inventing a cause", () => {
        expect(revertMessage("some_new_contract_error")).toBe(
            "some_new_contract_error",
        );
    });
});
