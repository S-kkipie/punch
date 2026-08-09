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

    it("redacts full mnemonic lines and private key lines", () => {
        expect(
            sanitizeMessage(
                "Mnemonic=test test test test test test test test test test test junk\nPrivate Keys\n(0) 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            ),
        ).toBe("Mnemonic=[redacted]\nPrivate Keys\n(0) [redacted]");
    });

    it("normalizes unknown errors without exposing their contents", () => {
        expect(normalizeError({ message: "private-key=oops" })).toEqual({
            name: "Error",
            message: "Unknown error",
        });
    });
});
