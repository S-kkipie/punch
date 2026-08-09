import { describe, expect, it } from "vitest";
import { normalizeError, sanitizeMessage } from "../error-redaction";

describe("worker error redaction", () => {
    it("redacts credential-bearing URLs and secret fields", () => {
        expect(
            sanitizeMessage(
                "https://alice:secret@example.test/x?token=abc password=hunter2",
            ),
        ).toBe(
            "https://[redacted]@example.test/x?token=[redacted] password=[redacted]",
        );
    });

    it("normalizes unknown errors without exposing their contents", () => {
        expect(normalizeError({ message: "private-key=oops" })).toEqual({
            name: "Error",
            message: "Unknown error",
        });
    });
});
