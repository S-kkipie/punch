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

    it("renders loading, error, and empty campaign states", () => {
        useCampaigns.mockReturnValue({ isPending: true });
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain("Cargando");

        useCampaigns.mockReturnValue({ isPending: false, isError: true });
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain(
            "No se pudieron cargar",
        );

        useCampaigns.mockReturnValue({
            isPending: false,
            isError: false,
            data: [],
        });
        expect(renderToStaticMarkup(<CampaignsPage />)).toContain(
            "Pronto habrá nuevas campañas",
        );
    });
});
