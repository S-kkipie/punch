import { describe, expect, it } from "vitest";
import { parseConsumerChainMode } from "../server-config";

describe("consumer chain mode", () => {
    it("defaults to local outside tests", () => {
        expect(parseConsumerChainMode(undefined, "development")).toBe("local");
    });

    it("allows mock mode for tests", () => {
        expect(parseConsumerChainMode("mock", "test")).toBe("mock");
    });

    it("rejects unsupported modes", () => {
        expect(() => parseConsumerChainMode("remote", "development")).toThrow();
    });
});
