import { describe, expect, it } from "vitest";
import {
    balanceAfterRedemption,
    canRedeem,
    PUNCH_REDEMPTION_COST,
    progressFraction,
} from "../progress";

describe("PUNCH_REDEMPTION_COST", () => {
    it("is fixed at 12", () => {
        expect(PUNCH_REDEMPTION_COST).toBe(12);
    });
});

describe("progressFraction", () => {
    it("returns balance/12 below the cap", () => {
        expect(progressFraction(5)).toEqual({ numerator: 5, denominator: 12 });
    });
    it("caps the numerator at 12 once eligible", () => {
        expect(progressFraction(15)).toEqual({
            numerator: 12,
            denominator: 12,
        });
    });
    it("rejects a non-integer balance", () => {
        expect(() => progressFraction(1.5)).toThrow("Invalid PUNCH balance");
    });
    it("rejects a negative balance", () => {
        expect(() => progressFraction(-1)).toThrow("Invalid PUNCH balance");
    });
});

describe("canRedeem / balanceAfterRedemption", () => {
    it("cannot redeem below 12", () => {
        expect(canRedeem(11)).toBe(false);
    });
    it("can redeem at exactly 12", () => {
        expect(canRedeem(12)).toBe(true);
    });
    it("subtracts exactly 12 on redemption", () => {
        expect(balanceAfterRedemption(14)).toBe(2);
    });
    it("throws when redeeming below 12", () => {
        expect(() => balanceAfterRedemption(11)).toThrow(
            "Insufficient PUNCH balance for redemption",
        );
    });
});
