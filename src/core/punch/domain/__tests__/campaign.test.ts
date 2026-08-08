import { describe, expect, it } from "vitest";
import { isEligibleForAcquisitionCampaign } from "../campaign";

const windowStart = new Date("2026-08-01T00:00:00Z");
const windowEnd = new Date("2026-08-31T23:59:59Z");

describe("isEligibleForAcquisitionCampaign", () => {
    it("is eligible for a first purchase at the target café inside the window", () => {
        expect(
            isEligibleForAcquisitionCampaign({
                campaignCafeId: "cafe-1",
                purchaseCafeId: "cafe-1",
                hadPriorPaidPurchaseAtCafe: false,
                purchaseAt: new Date("2026-08-08T12:00:00Z"),
                campaignWindowStart: windowStart,
                campaignWindowEnd: windowEnd,
            }),
        ).toBe(true);
    });
    it("is ineligible with a prior paid purchase at that café", () => {
        expect(
            isEligibleForAcquisitionCampaign({
                campaignCafeId: "cafe-1",
                purchaseCafeId: "cafe-1",
                hadPriorPaidPurchaseAtCafe: true,
                purchaseAt: new Date("2026-08-08T12:00:00Z"),
                campaignWindowStart: windowStart,
                campaignWindowEnd: windowEnd,
            }),
        ).toBe(false);
    });
    it("is ineligible at a different café", () => {
        expect(
            isEligibleForAcquisitionCampaign({
                campaignCafeId: "cafe-1",
                purchaseCafeId: "cafe-2",
                hadPriorPaidPurchaseAtCafe: false,
                purchaseAt: new Date("2026-08-08T12:00:00Z"),
                campaignWindowStart: windowStart,
                campaignWindowEnd: windowEnd,
            }),
        ).toBe(false);
    });
    it("is ineligible outside the campaign window", () => {
        expect(
            isEligibleForAcquisitionCampaign({
                campaignCafeId: "cafe-1",
                purchaseCafeId: "cafe-1",
                hadPriorPaidPurchaseAtCafe: false,
                purchaseAt: new Date("2026-09-01T00:00:01Z"),
                campaignWindowStart: windowStart,
                campaignWindowEnd: windowEnd,
            }),
        ).toBe(false);
    });
});
