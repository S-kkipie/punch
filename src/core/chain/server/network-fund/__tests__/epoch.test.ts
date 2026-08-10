import { describe, expect, it } from "vitest";
import { currentEpoch, requestedEpoch } from "../epoch";

describe("requestedEpoch", () => {
    it("rejects a bare --epoch flag", () => {
        expect(() => requestedEpoch(["--epoch"])).toThrow(
            "El argumento --epoch debe usar YYYYMM con un mes del 01 al 12",
        );
    });

    it.each([
        "",
        "20260",
        "2026013",
        "202613",
        "202600",
        "abc",
    ])("rejects malformed epoch value %j", (value) => {
        expect(() => requestedEpoch([`--epoch=${value}`])).toThrow(
            "El argumento --epoch debe usar YYYYMM con un mes del 01 al 12",
        );
    });

    it("accepts a valid YYYYMM value", () => {
        expect(requestedEpoch(["--epoch", "202607"])).toBe(202607);
    });

    it("uses the injected current epoch when --epoch is absent", () => {
        expect(requestedEpoch([], 202608)).toBe(202608);
    });
});

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
