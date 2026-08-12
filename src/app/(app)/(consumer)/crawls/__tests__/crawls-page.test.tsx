import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useCrawls } = vi.hoisted(() => ({ useCrawls: vi.fn() }));
vi.mock("@/core/punch/client/hooks", () => ({ useCrawls }));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import CrawlsPage from "../page";

describe("CrawlsPage states", () => {
    beforeEach(() => useCrawls.mockReset());

    it("renders loading, error, empty, and crawl rows", () => {
        useCrawls.mockReturnValue({ isPending: true });
        expect(renderToStaticMarkup(<CrawlsPage />)).toContain("Cargando");

        useCrawls.mockReturnValue({ isPending: false, isError: true });
        expect(renderToStaticMarkup(<CrawlsPage />)).toContain(
            "No se pudieron cargar las rutas",
        );

        useCrawls.mockReturnValue({
            isPending: false,
            isError: false,
            data: [],
        });
        expect(renderToStaticMarkup(<CrawlsPage />)).toContain(
            "No hay más rutas en tu zona",
        );

        useCrawls.mockReturnValue({
            isPending: false,
            isError: false,
            data: [
                {
                    id: "route-1",
                    name: "Ruta Brújula",
                    expiresAt: "2030-01-01T00:00:00Z",
                    steps: [
                        { stepIndex: 0, cafeId: "cafe-1" },
                        { stepIndex: 1, cafeId: "cafe-2" },
                    ],
                },
            ],
        });
        expect(renderToStaticMarkup(<CrawlsPage />)).toContain("Ruta Brújula");
        expect(renderToStaticMarkup(<CrawlsPage />)).toContain("2 pasos");
    });
});
