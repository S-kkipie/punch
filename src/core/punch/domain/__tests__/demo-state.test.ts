import { describe, expect, it } from "vitest";
import {
    DEMO_CAMPAIGN_NAME,
    DEMO_CRAWL_NAME,
    demoCampaignValues,
    demoCrawlSteps,
    demoCrawlValues,
} from "../demo-state";

describe("deterministic demo state", () => {
    it("normalizes campaign metadata from a fixed clock", () => {
        const values = demoCampaignValues(Date.UTC(2026, 0, 31), "cafe-sur");
        expect(values).toMatchObject({
            kind: "verified_acquisition",
            cafeId: "cafe-sur",
            name: DEMO_CAMPAIGN_NAME,
            active: true,
        });
        expect(values.windowEnd.getTime() - values.windowStart.getTime()).toBe(
            37 * 86_400_000,
        );
    });

    it("normalizes crawl metadata and exact ordered steps", () => {
        expect(demoCrawlValues(Date.UTC(2026, 0, 31))).toMatchObject({
            name: DEMO_CRAWL_NAME,
            active: true,
        });
        expect(demoCrawlSteps("crawl-1", ["a", "b", "c"])).toEqual([
            { crawlId: "crawl-1", stepIndex: 0, cafeId: "a" },
            { crawlId: "crawl-1", stepIndex: 1, cafeId: "b" },
            { crawlId: "crawl-1", stepIndex: 2, cafeId: "c" },
        ]);
    });
});
