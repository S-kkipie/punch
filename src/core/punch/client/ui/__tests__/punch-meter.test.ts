import { describe, expect, it } from "vitest";
import { punchMeterLabel } from "../punch-meter";

describe("punchMeterLabel", () => {
    it("shows the raw fraction below the cap", () => {
        expect(punchMeterLabel(5)).toBe("5 / 12");
    });
    it("shows the eligible message at or above the cap", () => {
        expect(punchMeterLabel(12)).toBe("12 / 12 — Recompensa disponible");
        expect(punchMeterLabel(15)).toBe("12 / 12 — Recompensa disponible");
    });
});
