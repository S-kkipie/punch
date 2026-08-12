// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { assign, signInAs } = vi.hoisted(() => ({
    assign: vi.fn(),
    signInAs: vi.fn().mockResolvedValue(undefined),
}));
const clientConfig = vi.hoisted(() => ({
    demoMode: true,
    demoPassword: "demo-password",
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/config/client-config", () => ({
    ClientConfig: clientConfig,
}));
vi.mock("@/frontend/components/auth/use-demo-sign-in", () => ({
    useDemoSignIn: () => ({
        signInAs,
        pending: null,
        error: null,
    }),
}));
vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({
        children,
        onClick,
        disabled,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
        variant?: string;
    }) => (
        <button type="button" onClick={onClick} disabled={Boolean(disabled)}>
            {children}
        </button>
    ),
}));

Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign },
});

import { FirstTimeHere } from "../first-time-here";

describe("FirstTimeHere", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        window.sessionStorage.removeItem("punch-demo-terminal-intro-dismissed");
        vi.clearAllMocks();
        clientConfig.demoMode = true;
        signInAs.mockReset();
    });

    it("renders only in demo mode with the demo guidance copy", async () => {
        const root = createRoot(document.body);

        await act(async () => root.render(<FirstTimeHere />));

        expect(document.body.textContent).toContain(
            "¿Primera vez aquí?La terminal es el lado cafetería: aquí se generan los códigos que el cliente escanea. Si aún no conoces el lado cliente, empieza por ahí.",
        );
        const buttons = [...document.querySelectorAll("button")];
        expect(
            buttons.some((button) =>
                button.textContent?.includes("Empezar como cliente"),
            ),
        ).toBe(true);

        await act(async () => root.unmount());
    });

    it("dismisses for the session and persists it in sessionStorage", async () => {
        const root = createRoot(document.body);
        await act(async () => root.render(<FirstTimeHere />));

        const dismissButton = [...document.querySelectorAll("button")].find(
            (button) => button.textContent?.includes("Quedarme aquí"),
        );

        await act(async () => dismissButton?.click());

        expect(
            window.sessionStorage.getItem(
                "punch-demo-terminal-intro-dismissed",
            ),
        ).toBe("true");
        expect(document.querySelector("section")).toBeNull();

        await act(async () => root.unmount());
    });

    it("starts as customer and preserves session dismissal", async () => {
        signInAs.mockImplementation(async (_email, destination) => {
            assign(destination);
            return undefined;
        });
        const root = createRoot(document.body);
        await act(async () => root.render(<FirstTimeHere />));

        const primary = [...document.querySelectorAll("button")].find(
            (button) => button.textContent?.includes("Empezar como cliente"),
        );
        await act(async () => primary?.click());

        expect(signInAs).toHaveBeenCalledWith(
            "demo-consumer@punch.pe",
            "/home",
        );
        expect(assign).toHaveBeenCalledWith("/home");

        await act(async () => root.unmount());
    });
});
