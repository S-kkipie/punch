import { describe, expect, it } from "vitest";

import {
    type CampaignViewerInput,
    campaignViewerState,
    vouchersLeft,
} from "../campaign-view";

const base: CampaignViewerInput = {
    published: true,
    windowStart: new Date("2026-08-01T00:00:00Z"),
    windowEnd: new Date("2026-09-01T00:00:00Z"),
    unlockedCount: 0,
    maxVouchers: 10,
    voucherStatus: null,
    hasPriorPurchaseAtCafe: false,
    now: new Date("2026-08-12T00:00:00Z"),
};

describe("campaignViewerState", () => {
    it("is open for a new client inside the window", () => {
        expect(campaignViewerState(base)).toBe("open");
    });

    it("reports the voucher the client already holds", () => {
        expect(
            campaignViewerState({ ...base, voucherStatus: "available" }),
        ).toBe("won");
        expect(
            campaignViewerState({ ...base, voucherStatus: "redeemed" }),
        ).toBe("used");
    });

    it("holds a campaign that is not on chain yet", () => {
        expect(campaignViewerState({ ...base, published: false })).toBe(
            "pending",
        );
    });

    it("closes outside the window", () => {
        expect(
            campaignViewerState({ ...base, now: new Date("2026-10-01") }),
        ).toBe("closed");
        expect(
            campaignViewerState({ ...base, now: new Date("2026-07-01") }),
        ).toBe("not_started");
    });

    it("reports a campaign whose vouchers ran out", () => {
        expect(campaignViewerState({ ...base, unlockedCount: 10 })).toBe(
            "full",
        );
    });

    it("tells a returning client they no longer qualify", () => {
        expect(
            campaignViewerState({ ...base, hasPriorPurchaseAtCafe: true }),
        ).toBe("not_new");
    });

    it("prefers the shared blockers over the personal one", () => {
        // Que se agotó le importa a todos; que este cliente no califica, solo a él.
        expect(
            campaignViewerState({
                ...base,
                unlockedCount: 10,
                hasPriorPurchaseAtCafe: true,
            }),
        ).toBe("full");
    });
});

describe("vouchersLeft", () => {
    it("counts what is left", () => {
        expect(vouchersLeft(3, 10)).toBe(7);
    });

    it("never goes negative", () => {
        expect(vouchersLeft(12, 10)).toBe(0);
    });

    it("returns null when there is no cap", () => {
        expect(vouchersLeft(3, null)).toBeNull();
    });
});
