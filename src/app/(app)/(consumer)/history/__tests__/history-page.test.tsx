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
