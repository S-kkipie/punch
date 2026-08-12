import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/drizzle/db", () => {
    // Cadena que se devuelve a sí misma: la lectura de campaña encadena dos
    // leftJoin (cafetería y proyección) antes del where.
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "from", "leftJoin"]) {
        chain[method] = vi.fn(() => chain);
    }
    chain.where = vi.fn(async () => []);
    return { db: chain };
});

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
