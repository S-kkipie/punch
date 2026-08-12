import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useCampaigns } = vi.hoisted(() => ({ useCampaigns: vi.fn() }));
vi.mock("@/core/punch/client/hooks", () => ({ useCampaigns }));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import CampaignsPage from "../page";

describe("CampaignsPage states", () => {
    beforeEach(() => useCampaigns.mockReset());

    it("renders loading, error, empty, and campaign rows", () => {
        useCampaigns.mockReturnValue({ isPending: true });
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain("Cargando");

        useCampaigns.mockReturnValue({ isPending: false, isError: true });
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain(
            "No se pudieron cargar las campañas",
        );

        useCampaigns.mockReturnValue({
            isPending: false,
            isError: false,
            data: [],
        });
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain(
            "Sin campañas activas",
        );

        useCampaigns.mockReturnValue({
            isPending: false,
            isError: false,
            data: [
                {
                    id: "c1",
                    kind: "verified_acquisition",
                    cafeId: "caf-1",
                    name: "Martes de filtrado",
                    windowStart: "2026-01-01T00:00:00Z",
                    windowEnd: "2030-01-01T00:00:00Z",
                    active: true,
                    voucherPayout: "4",
                    maxVouchers: 20,
                },
            ],
        });
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain(
            "Martes de filtrado",
        );
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain("0 de 20");
    });
});
