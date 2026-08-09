import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/balance", () => ({ getBalance: vi.fn() }));
vi.mock("../../repository/dashboard", () => ({
    getDashboardReadData: vi.fn(),
}));

import { getBalance } from "../../repository/balance";
import { getDashboardReadData } from "../../repository/dashboard";
import { getDashboardService } from "../get-dashboard-service";

const summaries = { activeCampaign: null, activeCrawl: null };

describe("getDashboardService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getDashboardReadData).mockResolvedValue(summaries);
    });

    it.each([
        0, 11, 12, 14,
    ])("maps balance %d and caps progress", async (balance) => {
        vi.mocked(getBalance).mockResolvedValue(balance);
        const result = await getDashboardService("user-1");
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.balance).toBe(balance);
            expect(result.data.progress).toEqual({
                numerator: Math.min(balance, 12),
                denominator: 12,
            });
        }
    });

    it("passes the authenticated user to the dashboard read repository", async () => {
        vi.mocked(getBalance).mockResolvedValue(4);
        await getDashboardService("user-1");
        expect(getDashboardReadData).toHaveBeenCalledWith("user-1");
    });

    it("maps active campaign and crawl summaries", async () => {
        vi.mocked(getBalance).mockResolvedValue(2);
        vi.mocked(getDashboardReadData).mockResolvedValue({
            activeCampaign: {
                id: "campaign-1",
                name: "Compra verificada",
                cafeId: "cafe-1",
            },
            activeCrawl: {
                id: "crawl-1",
                name: "Ruta del café",
                completedSteps: 2,
                totalSteps: 4,
            },
        });
        const result = await getDashboardService("user-1");
        expect(result.ok && result.data.activeCampaign).toEqual({
            id: "campaign-1",
            name: "Compra verificada",
            cafeId: "cafe-1",
        });
        expect(result.ok && result.data.activeCrawl).toEqual({
            id: "crawl-1",
            name: "Ruta del café",
            completedSteps: 2,
            totalSteps: 4,
        });
    });

    it("returns null summaries for an empty state", async () => {
        vi.mocked(getBalance).mockResolvedValue(0);
        const result = await getDashboardService("user-1");
        expect(result.ok && result.data.activeCampaign).toBeNull();
        expect(result.ok && result.data.activeCrawl).toBeNull();
    });

    it("degrades optional summaries to empty state when their read fails", async () => {
        vi.mocked(getBalance).mockResolvedValue(11);
        vi.mocked(getDashboardReadData).mockRejectedValue(
            new Error("database unavailable"),
        );
        const result = await getDashboardService("user-1");
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.balance).toBe(11);
            expect(result.data.activeCampaign).toBeNull();
            expect(result.data.activeCrawl).toBeNull();
        }
    });
});
