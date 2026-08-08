import { describe, expect, it } from "vitest";
import { solesToMpen } from "../schemas";
import { canTransition } from "../transitions";

describe("canTransition", () => {
    it("allows the happy path", () => {
        expect(canTransition("user_confirmed", "cafe_confirmed")).toBe(true);
        expect(canTransition("cafe_confirmed", "queued")).toBe(true);
        expect(canTransition("queued", "submitted")).toBe(true);
        expect(canTransition("submitted", "confirmed")).toBe(true);
    });
    it("allows failure and expiry edges", () => {
        expect(canTransition("submitted", "failed")).toBe(true);
        expect(canTransition("queued", "failed")).toBe(true);
        expect(canTransition("user_confirmed", "expired")).toBe(true);
    });
    it("rejects everything else", () => {
        expect(canTransition("confirmed", "failed")).toBe(false);
        expect(canTransition("user_confirmed", "queued")).toBe(false);
        expect(canTransition("expired", "cafe_confirmed")).toBe(false);
        expect(canTransition("failed", "confirmed")).toBe(false);
    });
});

describe("solesToMpen", () => {
    it("converts with 6 decimals", () => {
        expect(solesToMpen(8.5)).toBe(8_500_000n);
        expect(solesToMpen(12)).toBe(12_000_000n);
    });
    it("rejects more than 2 decimals and non-positive", () => {
        expect(() => solesToMpen(8.555)).toThrow();
        expect(() => solesToMpen(0)).toThrow();
    });
});
