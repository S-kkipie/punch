import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const useCrawl = vi.hoisted(() => vi.fn());
const useVouchers = vi.hoisted(() => vi.fn());
const useDashboard = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
    useParams: () => ({ crawlId: "crawl-1" }),
}));
vi.mock("@/core/punch/client/hooks", () => ({
    useCrawl,
    useVouchers,
    useDashboard,
}));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import CrawlDetailPage from "../page";

describe("CrawlDetailPage voucher provenance", () => {
    it("links the crawl voucher to the deterministic first crawl café", () => {
        useCrawl.mockReturnValue({
            isPending: false,
            isError: false,
            data: {
                name: "Ruta",
                steps: [
                    { stepIndex: 0, cafeId: "cafe-1" },
                    { stepIndex: 1, cafeId: "cafe-2" },
                ],
            },
        });
        useDashboard.mockReturnValue({
            isPending: false,
            data: {
                activeCrawl: {
                    id: "crawl-1",
                    name: "Ruta",
                    completedSteps: 1,
                    totalSteps: 2,
                },
                activeCampaign: null,
                balance: null,
                stale: false,
                chainMode: "mock",
                progress: null,
            },
        });
        useVouchers.mockReturnValue({
            data: [
                {
                    id: "crawl-voucher",
                    crawlId: "crawl-1",
                    source: "crawl",
                    status: "available",
                    cafeId: null,
                },
            ],
        });
        const markup = renderToStaticMarkup(<CrawlDetailPage />);
        expect(markup).toContain("voucherId=crawl-voucher");
        expect(markup).toContain("cafeId=cafe-1");
        expect(markup).toContain("<s>");
    });
});
