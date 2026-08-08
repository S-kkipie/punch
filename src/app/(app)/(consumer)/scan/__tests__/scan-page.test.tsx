import { describe, expect, it } from "vitest";
import { extractProofId } from "../page";

describe("scan pasted fallback", () => {
    it("extracts a proof id from a pasted purchase link", () => {
        expect(
            extractProofId("  https://punch.test/purchase/proof-123  "),
        ).toBe("proof-123");
    });

    it("does not navigate for an empty pasted value", () => {
        expect(extractProofId("   ")).toBeUndefined();
    });
});
