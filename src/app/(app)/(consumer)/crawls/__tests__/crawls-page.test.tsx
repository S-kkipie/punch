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

    it("renders loading, error, and empty crawl states", () => {
        useCrawls.mockReturnValue({ isPending: true });
        expect(renderToStaticMarkup(<CrawlsPage />)).toContain("Cargando");

        useCrawls.mockReturnValue({ isPending: false, isError: true });
        expect(renderToStaticMarkup(<CrawlsPage />)).toContain(
            "No se pudieron cargar",
        );

        useCrawls.mockReturnValue({
            isPending: false,
            isError: false,
            data: [],
        });
        expect(renderToStaticMarkup(<CrawlsPage />)).toContain(
            "Pronto habrá nuevas rutas",
        );
    });
});
