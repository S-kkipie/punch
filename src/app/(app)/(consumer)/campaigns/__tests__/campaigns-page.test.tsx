import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useCampaigns, useVouchers } = vi.hoisted(() => ({
    useCampaigns: vi.fn(),
    useVouchers: vi.fn(),
}));
const { useHistory } = vi.hoisted(() => ({ useHistory: vi.fn() }));
vi.mock("@/core/punch/client/hooks", () => ({ useCampaigns, useVouchers }));
vi.mock("@/core/consumption/client/hooks", () => ({ useHistory }));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import CampaignsPage from "../page";

const campaign = {
    id: "c1",
    kind: "verified_acquisition",
    cafeId: "caf-1",
    cafeName: "Esquina Sur",
    name: "Martes de filtrado",
    windowStart: "2026-01-01T00:00:00Z",
    windowEnd: "2030-01-01T00:00:00Z",
    active: true,
    voucherPayout: "5000000",
    voucherPayoutSoles: 5,
    maxVouchers: 20,
    unlockedCount: 3,
    published: true,
};

describe("CampaignsPage states", () => {
    beforeEach(() => {
        useCampaigns.mockReset();
        useVouchers.mockReturnValue({ data: [] });
        useHistory.mockReturnValue({ data: [], isPending: false });
    });

    it("renders loading, error, and empty states", () => {
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
    });

    it("shows the payout in soles and the real voucher count", () => {
        useCampaigns.mockReturnValue({
            isPending: false,
            isError: false,
            data: [campaign],
        });
        const markup = renderToStaticMarkup(<CampaignsPage />);
        expect(markup).toContain("Martes de filtrado");
        // El monto llega en unidades base; la pantalla nunca debe mostrarlas.
        expect(markup).toContain("S/5.00");
        expect(markup).not.toContain("5000000");
        expect(markup).toContain("3 de 20 ya tomados");
        expect(markup).toContain("Puedes ganarla ahora");
    });

    it("tells a returning client that the campaign no longer applies", () => {
        useCampaigns.mockReturnValue({
            isPending: false,
            isError: false,
            data: [campaign],
        });
        useHistory.mockReturnValue({
            data: [
                {
                    cafeId: "caf-1",
                    operation: "emission",
                    status: "confirmed",
                },
            ],
            isPending: false,
        });
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain(
            "Ya eras cliente de esta cafetería",
        );
    });

    it("marks a campaign the client already won", () => {
        useCampaigns.mockReturnValue({
            isPending: false,
            isError: false,
            data: [campaign],
        });
        useVouchers.mockReturnValue({
            data: [{ campaignId: "c1", status: "available" }],
        });
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain(
            "Ya la ganaste",
        );
    });
});
