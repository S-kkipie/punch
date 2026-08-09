import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useHistory } = vi.hoisted(() => ({ useHistory: vi.fn() }));
vi.mock("@/core/consumption/client/hooks", () => ({ useHistory }));
vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({ children }: { children: ReactNode }) => (
        <button type="button">{children}</button>
    ),
}));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import HistoryPage from "../page";

describe("HistoryPage states", () => {
    beforeEach(() => useHistory.mockReset());

    it("renders distinct café and provenance details", () => {
        useHistory.mockReturnValue({
            isPending: false,
            isError: false,
            data: [
                {
                    id: "purchase",
                    operation: "emission",
                    status: "confirmed",
                    cafeName: "Brújula Café",
                    productName: "Espresso",
                    rejectionReason: null,
                    createdAt: "2026-08-08T12:00:00Z",
                },
                {
                    id: "voucher",
                    operation: "voucher_redemption",
                    status: "confirmed",
                    cafeName: "Patio 9",
                    crawlName: "Ruta del café",
                    rejectionReason: null,
                    createdAt: "2026-08-08T13:00:00Z",
                },
            ],
        });
        const markup = renderToStaticMarkup(<HistoryPage />);
        expect(markup).toContain("Brújula Café · Espresso");
        expect(markup).toContain("Patio 9 · Recorrido: Ruta del café");
        expect(markup).toContain("PUNCH ganado");
        expect(markup).toContain("Voucher usado");
    });

    it("shows loading, error retry, and empty states", () => {
        useHistory.mockReturnValue({ isPending: true });
        expect(renderToStaticMarkup(<HistoryPage />)).toContain("Cargando");

        useHistory.mockReturnValue({
            isPending: false,
            isError: true,
            refetch: vi.fn(),
        });
        expect(renderToStaticMarkup(<HistoryPage />)).toContain("Reintentar");

        useHistory.mockReturnValue({
            isPending: false,
            isError: false,
            data: [],
        });
        expect(renderToStaticMarkup(<HistoryPage />)).toContain(
            "Todavía no tienes actividad.",
        );
    });
});
