import { describe, expect, it } from "vitest";
import {
    canonicalDemoCrawlId,
    DEMO_APPLICANT_EMAIL,
    DEMO_CAMPAIGN_NAME,
    DEMO_CRAWL_NAME,
    demoCampaignValues,
    demoCrawlSteps,
    demoCrawlValues,
} from "../demo-state";

describe("deterministic demo state", () => {
    it("keeps the review café applicant separate from the consumer", () => {
        expect(DEMO_APPLICANT_EMAIL).toBe("quinto@punch.pe");
        expect(DEMO_APPLICANT_EMAIL).not.toBe("demo-consumer@punch.pe");
    });

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

    it("selects only the canonical crawl and never an unrelated crawl", () => {
        expect(
            canonicalDemoCrawlId([
                { id: "unrelated", name: "Ruta de otro colectivo" },
            ]),
        ).toBeUndefined();
        expect(
            canonicalDemoCrawlId([
                { id: "unrelated", name: "Ruta de otro colectivo" },
                { id: "canonical", name: DEMO_CRAWL_NAME },
            ]),
        ).toBe("canonical");
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
