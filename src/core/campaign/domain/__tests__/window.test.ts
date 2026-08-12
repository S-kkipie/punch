import { describe, expect, it } from "vitest";

import {
    DEFAULT_WINDOW_DAYS,
    defaultCampaignWindow,
    toDateTimeLocal,
} from "../window";

describe("toDateTimeLocal", () => {
    it("formats what a datetime-local input accepts", () => {
        expect(toDateTimeLocal(new Date(2026, 7, 12, 9, 5))).toBe(
            "2026-08-12T09:05",
        );
    });

    it("pads every part", () => {
        expect(toDateTimeLocal(new Date(2026, 0, 2, 3, 4))).toBe(
            "2026-01-02T03:04",
        );
    });
});

describe("defaultCampaignWindow", () => {
    it("opens now and closes a month ahead", () => {
        const now = new Date(2026, 7, 12, 10, 0);
        expect(defaultCampaignWindow(now)).toEqual({
            start: "2026-08-12T10:00",
            end: "2026-09-11T10:00",
        });
    });

    it("always ends in the future", () => {
        const now = new Date();
        const { end } = defaultCampaignWindow(now);
        expect(new Date(end).getTime()).toBeGreaterThan(now.getTime());
    });

    it("crosses a month boundary without breaking", () => {
        expect(defaultCampaignWindow(new Date(2026, 11, 20, 8, 30)).end).toBe(
            "2027-01-19T08:30",
        );
    });

    it("keeps the documented window length", () => {
        expect(DEFAULT_WINDOW_DAYS).toBe(30);
    });
});
