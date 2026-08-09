import { describe, expect, it } from "vitest";
import { canPublish, lifecycleOf, requiredBudget } from "../transitions";

const projection = {
    chainCampaignId: 1,
    status: "draft" as const,
    budget: 500n,
    voucherPayout: 0n,
    maxVouchers: 0,
    expiry: new Date(0),
    unlockedCount: 0,
    redeemedCount: 0,
    lastBlock: 1n,
    lastTransactionIndex: 0,
    lastLogIndex: 0,
};

describe("requiredBudget", () => {
    it("multiplies payout by cap", () => {
        expect(requiredBudget({ voucherPayout: 50n, maxVouchers: 10 })).toBe(
            500n,
        );
    });
});

describe("lifecycleOf", () => {
    it("is creating until the chain id lands", () => {
        expect(lifecycleOf({ chainCampaignId: null }, null)).toBe("creating");
    });

    it("is draft once created on chain", () => {
        expect(lifecycleOf({ chainCampaignId: 1 }, projection)).toBe("draft");
    });

    it("is published once the escrow says so", () => {
        expect(
            lifecycleOf(
                { chainCampaignId: 1 },
                { ...projection, status: "published" },
            ),
        ).toBe("published");
    });
});

describe("canPublish", () => {
    it("requires the chain budget to cover every promised voucher", () => {
        expect(canPublish(projection, 500n)).toBe(true);
        expect(canPublish(projection, 501n)).toBe(false);
    });

    it("refuses a campaign that is not a draft", () => {
        expect(canPublish({ ...projection, status: "published" }, 500n)).toBe(
            false,
        );
    });

    it("refuses when the chain has not confirmed creation", () => {
        expect(canPublish(null, 0n)).toBe(false);
    });
});
