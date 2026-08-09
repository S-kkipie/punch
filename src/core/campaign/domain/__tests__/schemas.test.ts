import { describe, expect, it } from "vitest";
import { createCampaignSchema } from "../schemas";

const valid = {
    name: "Primera visita",
    windowStart: new Date("2026-09-01T00:00:00Z"),
    windowEnd: new Date("2026-09-30T00:00:00Z"),
    voucherPayout: 5_000_000n,
    maxVouchers: 20,
};

describe("createCampaignSchema", () => {
    it("accepts a well formed campaign", () => {
        expect(createCampaignSchema.parse(valid)).toMatchObject({
            maxVouchers: 20,
        });
    });

    it("rejects an inverted window", () => {
        expect(() =>
            createCampaignSchema.parse({
                ...valid,
                windowEnd: new Date("2026-08-01T00:00:00Z"),
            }),
        ).toThrow();
    });

    it("rejects a zero payout or cap, which publishCampaign would revert on", () => {
        expect(() =>
            createCampaignSchema.parse({ ...valid, voucherPayout: 0n }),
        ).toThrow();
        expect(() =>
            createCampaignSchema.parse({ ...valid, maxVouchers: 0 }),
        ).toThrow();
    });

    it("rejects a cap that does not fit SQL integer", () => {
        expect(() =>
            createCampaignSchema.parse({
                ...valid,
                maxVouchers: 2_147_483_648,
            }),
        ).toThrow();
    });
});
