import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/drizzle/db", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({ where: vi.fn(async () => []) })),
        })),
    },
}));

import { getCampaignService } from "../list-campaigns-service";
import { getCrawlService } from "../list-crawls-service";

describe("consumer punch detail reads", () => {
    it("returns typed NOT_FOUND for an absent campaign", async () => {
        const result = await getCampaignService("missing-campaign");
        expect(result).toEqual({
            ok: false,
            error: expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
        });
    });

    it("returns typed NOT_FOUND for an absent crawl", async () => {
        const result = await getCrawlService("missing-crawl");
        expect(result).toEqual({
            ok: false,
            error: expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
        });
    });
});
