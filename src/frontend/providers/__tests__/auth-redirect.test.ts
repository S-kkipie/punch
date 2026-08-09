import { describe, expect, it } from "vitest";
import { authRedirectTarget } from "../auth-redirect";

describe("auth redirect target", () => {
    it("returns the requested destination instead of always home", () => {
        expect(authRedirectTarget("/purchase/quote-123")).toBe(
            "/purchase/quote-123",
        );
        expect(authRedirectTarget(null)).toBe("/home");
    });
});
