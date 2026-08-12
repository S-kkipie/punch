// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const useDemoSignIn = vi.hoisted(() => vi.fn());

vi.mock("@/frontend/components/auth/sign-out-button", () => ({
    SignOutButton: () => <button type="button">Cerrar sesión</button>,
}));
vi.mock("@/frontend/components/guide/demo-only", () => ({
    DemoOnly: () => <span>DemoOnly</span>,
}));
vi.mock("@/frontend/components/auth/use-demo-sign-in", () => ({
    useDemoSignIn,
}));
vi.mock("@/config/client-config", () => ({
    ClientConfig: { demoMode: true },
}));

useDemoSignIn.mockReturnValue({
    signInAs: vi.fn(),
    pending: false,
    error: null,
});

import MorePage from "../page";

describe("MorePage", () => {
    it("shows glossary entries and keeps primary links", () => {
        const markup = renderToStaticMarkup(<MorePage />);
        expect(markup).toContain("¿Qué es un sello?");
        expect(markup).toContain("¿Qué es el fondo común?");
        expect(markup).toContain("¿Por qué en blockchain?");
        expect(markup).toContain('href="/campaigns"');
        expect(markup).toContain('href="/crawls"');
        expect(markup).toContain('href="/profile"');
        expect(markup).toContain('href="/install"');
    });

    it("switches role via demo sign-in helper", async () => {
        const signInAs = vi.fn().mockResolvedValue(undefined);
        useDemoSignIn.mockReturnValue({
            signInAs,
            pending: false,
            error: null,
        });

        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(<MorePage />);
        });

        const transferButton = Array.from(
            container.querySelectorAll("button"),
        ).find((button) => button.textContent === "Pasa a cafetería");
        expect(transferButton).not.toBeUndefined();

        await act(async () => {
            transferButton?.dispatchEvent(
                new MouseEvent("click", {
                    bubbles: true,
                }),
            );
        });

        expect(signInAs).toHaveBeenCalledWith("brujula@punch.pe", "/cafe");
        await act(async () => {
            root.unmount();
        });
    });
});
