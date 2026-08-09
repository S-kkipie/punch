import { describe, expect, it } from "vitest";
import { authRedirectTarget } from "../auth-redirect";

describe("auth redirect target", () => {
    it.each([
        ["//evil.com", "/home"],
        ["/\\evil.com", "/home"],
        ["https://evil.com", "/home"],
        ["javascript:alert(1)", "/home"],
        ["", "/home"],
        [null, "/home"],
        ["/purchase/abc123", "/purchase/abc123"],
    ])("allows only safe same-origin paths: %s", (input, expected) => {
        expect(authRedirectTarget(input)).toBe(expected);
    });
});
