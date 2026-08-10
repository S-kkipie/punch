import { describe, expect, it } from "vitest";
import { calculateCampaignFunding } from "../funding";

describe("calculateCampaignFunding", () => {
    it("uses zero funding and creating lifecycle without a projection", () => {
        expect(
            calculateCampaignFunding(
                { voucherPayout: 3n, maxVouchers: 4, chainCampaignId: null },
                null,
            ),
        ).toEqual({
            required: 12n,
            funded: 0n,
            missing: 12n,
            lifecycle: "creating",
            canPublish: false,
        });
    });

    it("returns funded draft values and enables publishing at the required budget", () => {
        expect(
            calculateCampaignFunding(
                { voucherPayout: 3n, maxVouchers: 4, chainCampaignId: 7 },
                { status: "draft", budget: 12n },
            ),
        ).toEqual({
            required: 12n,
            funded: 12n,
            missing: 0n,
            lifecycle: "draft",
            canPublish: true,
        });
    });
});
