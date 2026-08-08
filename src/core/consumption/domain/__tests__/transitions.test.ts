import { describe, expect, it } from "vitest";
import {
    canTransitionFulfillment,
    canTransitionTransaction,
} from "../transitions";

describe("canTransitionTransaction", () => {
    it("allows pending to confirmed, rejected, or failed", () => {
        expect(canTransitionTransaction("pending", "confirmed")).toBe(true);
        expect(canTransitionTransaction("pending", "rejected")).toBe(true);
        expect(canTransitionTransaction("pending", "failed")).toBe(true);
    });
    it("allows a retry from failed back to pending", () => {
        expect(canTransitionTransaction("failed", "pending")).toBe(true);
    });
    it("forbids leaving a terminal confirmed state", () => {
        expect(canTransitionTransaction("confirmed", "pending")).toBe(false);
        expect(canTransitionTransaction("confirmed", "rejected")).toBe(false);
    });
    it("forbids leaving a terminal rejected state", () => {
        expect(canTransitionTransaction("rejected", "pending")).toBe(false);
    });
});

describe("canTransitionFulfillment", () => {
    it("allows pending to approved or rejected only", () => {
        expect(canTransitionFulfillment("pending", "approved")).toBe(true);
        expect(canTransitionFulfillment("pending", "rejected")).toBe(true);
    });
    it("forbids deciding an already-decided request", () => {
        expect(canTransitionFulfillment("approved", "rejected")).toBe(false);
        expect(canTransitionFulfillment("rejected", "approved")).toBe(false);
    });
});
