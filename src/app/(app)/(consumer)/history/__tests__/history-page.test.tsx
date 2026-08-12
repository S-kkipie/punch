import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useHistory } = vi.hoisted(() => ({ useHistory: vi.fn() }));
vi.mock("@/core/consumption/client/hooks", () => ({ useHistory }));

const confirmedEntry = {
    id: "purchase",
    operation: "emission",
    status: "confirmed",
    cafeName: "Brújula Café",
    productName: "Latte",
    rejectionReason: null,
    createdAt: "2026-08-11T14:14:00.000Z",
    transactionHash:
        "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92",
};

import HistoryPage from "../page";

describe("HistoryPage states", () => {
    beforeEach(() => {
        useHistory.mockReset();
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
    });

    afterEach(() => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
    });

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

    it("renders status badges for activity rows", () => {
        useHistory.mockReturnValue({
            isPending: false,
            isError: false,
            data: [
                {
                    ...confirmedEntry,
                    id: "confirmed",
                    status: "confirmed",
                },
                {
                    ...confirmedEntry,
                    id: "pending",
                    status: "pending",
                },
                {
                    ...confirmedEntry,
                    id: "rejected",
                    status: "rejected",
                    rejectionReason: "Límite diario excedido",
                },
            ],
        });

        const markup = renderToStaticMarkup(<HistoryPage />);
        expect(markup).toContain("history-badge history-badge--ok");
        expect(markup).toContain("Listo");
        expect(markup).toContain("history-badge history-badge--pending");
        expect(markup).toContain("En proceso");
        expect(markup).toContain("history-badge history-badge--rejected");
        expect(markup).toContain("No aprobado");
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
            "Todavía no tienes actividad",
        );
    });

    it("links each confirmed row to its Arbitrum transaction", () => {
        useHistory.mockReturnValue({
            isPending: false,
            isError: false,
            data: [confirmedEntry],
        });
        const markup = renderToStaticMarkup(<HistoryPage />);
        expect(markup).toContain(
            `href="https://sepolia.arbiscan.io/tx/${confirmedEntry.transactionHash}"`,
        );
    });

    it("explains that confirmed operations can be verified publicly", () => {
        const previousChainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV;
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
        try {
            useHistory.mockReturnValue({
                isPending: false,
                isError: false,
                data: [],
            });
            const markup = renderToStaticMarkup(<HistoryPage />);
            expect(markup).toContain("puedes abrir cada una para verificarla");
        } finally {
            process.env.NEXT_PUBLIC_CHAIN_ENV = previousChainEnv;
        }
    });

    it("explains local-chain confirmation without promising a public link", () => {
        const previousChainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV;
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
        try {
            useHistory.mockReturnValue({
                isPending: false,
                isError: false,
                data: [],
            });
            const markup = renderToStaticMarkup(<HistoryPage />);
            expect(markup).not.toContain("puedes abrir cada una");
            expect(markup).toContain("cadena local de desarrollo");
        } finally {
            process.env.NEXT_PUBLIC_CHAIN_ENV = previousChainEnv;
        }
    });

    it("says it is waiting instead of rendering a dead link", () => {
        useHistory.mockReturnValue({
            isPending: false,
            isError: false,
            data: [
                { ...confirmedEntry, status: "pending", transactionHash: null },
            ],
        });
        const markup = renderToStaticMarkup(<HistoryPage />);
        expect(markup).not.toContain("arbiscan");
        expect(markup).toContain("Esperando confirmación");
    });

    it("does not claim every pending row is already on chain", () => {
        useHistory.mockReturnValue({
            isPending: false,
            isError: false,
            data: [
                { ...confirmedEntry, status: "pending", transactionHash: null },
            ],
        });
        const markup = renderToStaticMarkup(<HistoryPage />);
        expect(markup).not.toContain("Cada línea existe en la cadena");
        expect(markup).toContain("Las operaciones confirmadas");
    });

    it("shows an empty state that explains how activity appears", () => {
        useHistory.mockReturnValue({
            isPending: false,
            isError: false,
            data: [],
        });
        expect(renderToStaticMarkup(<HistoryPage />)).toContain("Escanea");
    });
});
