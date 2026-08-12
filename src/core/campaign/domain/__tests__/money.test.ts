import { describe, expect, it } from "vitest";

import { formatMpenAsSoles, parseSolesToMpen } from "../money";

describe("parseSolesToMpen", () => {
    it("converts whole soles", () => {
        expect(parseSolesToMpen("5")).toBe(5_000_000n);
    });

    it("converts céntimos", () => {
        expect(parseSolesToMpen("5.50")).toBe(5_500_000n);
        expect(parseSolesToMpen("0.05")).toBe(50_000n);
        expect(parseSolesToMpen("5.5")).toBe(5_500_000n);
    });

    it("rejects amounts it would have to round", () => {
        expect(parseSolesToMpen("5.505")).toBeNull();
    });

    it("rejects zero, negatives and junk", () => {
        expect(parseSolesToMpen("0")).toBeNull();
        expect(parseSolesToMpen("-5")).toBeNull();
        expect(parseSolesToMpen("cinco")).toBeNull();
        expect(parseSolesToMpen("")).toBeNull();
    });

    it("ignores surrounding spaces", () => {
        expect(parseSolesToMpen("  5.50 ")).toBe(5_500_000n);
    });
});

describe("formatMpenAsSoles", () => {
    it("formats base units", () => {
        expect(formatMpenAsSoles(5_000_000n)).toBe("S/5.00");
        expect(formatMpenAsSoles(5_500_000n)).toBe("S/5.50");
        expect(formatMpenAsSoles(50_000n)).toBe("S/0.05");
        expect(formatMpenAsSoles(0n)).toBe("S/0.00");
    });

    it("accepts the string the API returns", () => {
        expect(formatMpenAsSoles("50000000")).toBe("S/50.00");
    });

    it("keeps the sign", () => {
        expect(formatMpenAsSoles(-5_000_000n)).toBe("-S/5.00");
    });

    it("round-trips with parseSolesToMpen", () => {
        for (const soles of ["1", "12.34", "0.01", "999.99"]) {
            const parsed = parseSolesToMpen(soles);
            expect(parsed).not.toBeNull();
            expect(formatMpenAsSoles(parsed as bigint)).toBe(
                `S/${Number(soles).toFixed(2)}`,
            );
        }
    });
});
