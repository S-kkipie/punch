// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const readPunchSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/frontend/components/consumer/offline-snapshot", () => ({
    readPunchSnapshot,
}));
vi.mock("@/frontend/auth/auth", () => ({
    authClient: {
        useSession: () => ({
            data: {
                user: {
                    id: "demo-user",
                },
            },
        }),
    },
}));
vi.mock("@/frontend/components/guide/empty-state", () => ({
    EmptyState: (props: {
        title: string;
        cause: string;
        action: { label: string; href: string };
    }) =>
        createElement(
            "section",
            null,
            createElement("h1", null, props.title),
            createElement("p", null, props.cause),
            createElement("a", { href: props.action.href }, props.action.label),
        ),
}));

import OfflinePage from "../page";

describe("public offline route", () => {
    it("shows a saved dashboard snapshot when available", async () => {
        readPunchSnapshot.mockReturnValue({
            balance: 11,
            progress: { numerator: 11, denominator: 12 },
            chainMode: "mock",
        });

        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(<OfflinePage />);
        });

        const markup = container.innerHTML;
        expect(markup).toContain("Sin conexión");
        expect(markup).toContain("Tus 11 / 12 sellos siguen en la cadena.");
        expect(markup).toContain(
            "Esta pantalla vuelve sola cuando haya señal.",
        );
        expect(markup).toContain("Tu progreso");
        expect(markup).toContain("11 / 12");
        expect(markup).toContain("Últimas 4 operaciones");
        expect(markup).toContain('href="/history"');
        expect(markup).toContain("Reintentar");

        expect(readPunchSnapshot).toHaveBeenCalledWith(
            expect.any(Object),
            "demo-user",
            "dashboard",
        );

        await act(async () => {
            root.unmount();
        });
    });

    it("renders empty state when snapshot is absent", () => {
        readPunchSnapshot.mockReturnValue(null);
        const markup = renderToStaticMarkup(<OfflinePage />);
        expect(markup).toContain("Sin conexión");
        expect(markup).toContain(
            "Todavía no hay datos para mostrarte sin señal. Conéctate para descargar tu estado local.",
        );
        expect(markup).toContain('href="/home"');
        expect(markup).toContain("Reintentar");
    });
});
