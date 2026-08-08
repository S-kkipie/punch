import { describe, expect, it } from "vitest";
import { advanceCrawl } from "../crawl";

const steps = [
    { stepIndex: 0, cafeId: "cafe-a" },
    { stepIndex: 1, cafeId: "cafe-b" },
    { stepIndex: 2, cafeId: "cafe-c" },
];
const now = new Date("2026-08-08T12:00:00Z");
const crawlExpiresAt = new Date("2026-12-31T23:59:59Z");

describe("advanceCrawl", () => {
    it("advances on the correct next step", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: ["cafe-a", "cafe-b"],
                purchaseCafeId: "cafe-c",
                now,
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: true, nextStepIndex: 3, crawlCompleted: true });
    });
    it("does not complete before the final step", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: [],
                purchaseCafeId: "cafe-a",
                now,
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: true, nextStepIndex: 1, crawlCompleted: false });
    });
    it("rejects a purchase at the wrong next café", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: ["cafe-a"],
                purchaseCafeId: "cafe-c",
                now,
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: false, reason: "not_next_step" });
    });
    it("rejects an expired crawl", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: [],
                purchaseCafeId: "cafe-a",
                now: new Date("2027-01-01T00:00:00Z"),
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: false, reason: "expired" });
    });
    it("rejects an already-completed crawl", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: ["cafe-a", "cafe-b", "cafe-c"],
                purchaseCafeId: "cafe-a",
                now,
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: false, reason: "already_completed" });
    });
});
