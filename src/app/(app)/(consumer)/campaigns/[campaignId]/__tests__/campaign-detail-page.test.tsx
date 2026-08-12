import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useCampaign = vi.hoisted(() => vi.fn());
const useVouchers = vi.hoisted(() => vi.fn());
const useHistory = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
    useParams: () => ({ campaignId: "campaign-1" }),
}));
vi.mock("@/core/punch/client/hooks", () => ({ useCampaign, useVouchers }));
vi.mock("@/core/consumption/client/hooks", () => ({ useHistory }));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import CampaignDetailPage from "../page";

const campaignData = {
    isPending: false,
    isError: false,
    data: {
        name: "Campaña",
        cafeId: "cafe-1",
        cafeName: "Esquina Sur",
        windowStart: "2020-01-01T00:00:00Z",
        windowEnd: "2030-01-01T00:00:00Z",
        voucherPayout: "5000000",
        voucherPayoutSoles: 5,
        maxVouchers: 20,
        unlockedCount: 3,
        published: true,
    },
};

describe("CampaignDetailPage", () => {
    beforeEach(() => {
        useCampaign.mockReturnValue(campaignData);
        useHistory.mockReturnValue({ data: [], isPending: false });
        useVouchers.mockReturnValue({ data: [] });
    });

    it("links only the voucher belonging to this campaign", () => {
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

    it("states the next move and the payout in soles", () => {
        const markup = renderToStaticMarkup(<CampaignDetailPage />);
        expect(markup).toContain("compra tu primer café ahí");
        expect(markup).toContain("S/5.00");
        expect(markup).not.toContain("5000000");
    });

    it("explains why a returning client does not qualify", () => {
        useHistory.mockReturnValue({
            data: [
                {
                    cafeId: "cafe-1",
                    operation: "emission",
                    status: "confirmed",
                },
            ],
            isPending: false,
        });
        expect(renderToStaticMarkup(<CampaignDetailPage />)).toContain(
            "solo para clientes nuevos",
        );
    });
});
