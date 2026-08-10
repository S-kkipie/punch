import { describe, expect, it } from "vitest";
import { currentEpoch } from "../epoch";

describe("currentEpoch", () => {
    it("formats YYYYMM in UTC", () => {
        expect(currentEpoch(new Date("2026-08-10T23:59:59Z"))).toBe(202608);
    });
    it("uses UTC at month boundaries", () => {
        expect(currentEpoch(new Date("2026-08-31T23:59:59Z"))).toBe(202608);
        expect(currentEpoch(new Date("2026-09-01T00:00:00Z"))).toBe(202609);
        expect(currentEpoch(new Date("2026-12-15T12:00:00Z"))).toBe(202612);
        expect(currentEpoch(new Date("2027-01-01T00:00:00Z"))).toBe(202701);
    });
});
