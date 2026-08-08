import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const useCampaign = vi.hoisted(() => vi.fn());
const useVouchers = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
    useParams: () => ({ campaignId: "campaign-1" }),
}));
vi.mock("@/core/punch/client/hooks", () => ({ useCampaign, useVouchers }));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import CampaignDetailPage from "../page";

describe("CampaignDetailPage voucher provenance", () => {
    it("links only the voucher belonging to this campaign", () => {
        useCampaign.mockReturnValue({
            isPending: false,
            isError: false,
            data: {
                name: "Campaña",
                cafeId: "cafe-1",
                windowEnd: "2030-01-01T00:00:00Z",
            },
        });
        useVouchers.mockReturnValue({
            data: [
                {
                    id: "wrong",
                    campaignId: "other",
                    source: "campaign",
                    status: "available",
                    cafeId: "cafe-1",
                },
                {
                    id: "right",
                    campaignId: "campaign-1",
                    source: "campaign",
                    status: "available",
                    cafeId: "cafe-1",
                },
            ],
        });
        const markup = renderToStaticMarkup(<CampaignDetailPage />);
        expect(markup).toContain("voucherId=right");
        expect(markup).not.toContain("voucherId=wrong");
    });
});
