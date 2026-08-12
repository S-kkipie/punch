// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { assign, signIn } = vi.hoisted(() => ({
    assign: vi.fn(),
    signIn: vi.fn(),
}));
const usePathname = vi.hoisted(() => vi.fn());
const clientConfig = vi.hoisted(() => ({
    demoMode: true,
    demoPassword: "demo-password",
}));

vi.mock("next/navigation", () => ({
    usePathname: () => usePathname(),
}));
vi.mock("@/config/client-config", () => ({
    ClientConfig: clientConfig,
}));
vi.mock("@/frontend/auth/auth", () => ({
    authClient: {
        signIn: {
            email: signIn,
        },
    },
}));

signIn.mockResolvedValue({ error: null });

import { DemoBar } from "../demo-bar";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

function buttonWithLabel(label: string) {
    return [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(label),
    ) as HTMLButtonElement | undefined;
}

describe("DemoBar", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        vi.clearAllMocks();
        signIn.mockResolvedValue({ error: null });
        clientConfig.demoMode = true;
        clientConfig.demoPassword = "demo-password";
        usePathname.mockReset();
    });

    it("does not mount outside demo mode", async () => {
        clientConfig.demoMode = false;
        usePathname.mockReturnValue("/home");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { assign },
        });

        await render(<DemoBar />);

        expect(document.querySelector(".demo-bar")).toBeNull();
    });

    it("derives the active role from the pathname", async () => {
        usePathname.mockReturnValue("/home");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { assign },
        });

        await render(<DemoBar />);

        expect(buttonWithLabel("Cliente")?.disabled).toBe(true);
        expect(buttonWithLabel("Cliente")?.getAttribute("aria-current")).toBe(
            "true",
        );

        usePathname.mockReturnValue("/ops");
        await render(<DemoBar />);

        expect(buttonWithLabel("Cafetería")?.disabled).toBe(true);
        expect(buttonWithLabel("Cafetería")?.getAttribute("aria-current")).toBe(
            "true",
        );
    });

    it("opens the transfer panel before switching roles", async () => {
        usePathname.mockReturnValue("/home");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { assign },
        });

        await render(<DemoBar />);
        await act(async () => buttonWithLabel("Cafetería")?.click());

        expect(
            document.querySelector(".demo-bar__panel")?.textContent,
        ).toContain(
            "Vas a pasar al lado cafetería (Café Brújula). Ahí generas códigos de compra y entregas canjes. Primer paso: abrir la terminal y generar un código.",
        );
        expect(signIn).not.toHaveBeenCalled();
    });

    it("calls sign-in with the café destination when accepting transfer", async () => {
        usePathname.mockReturnValue("/home");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { assign },
        });

        await render(<DemoBar />);
        await act(async () => buttonWithLabel("Cafetería")?.click());
        const confirm = buttonWithLabel("Cambiar a Cafetería");
        await act(async () => confirm?.click());

        expect(signIn).toHaveBeenCalledWith({
            email: "brujula@punch.pe",
            password: "demo-password",
        });
        expect(assign).toHaveBeenCalledWith("/cafe");
    });

    it("disables both role buttons and shows loading text while pending", async () => {
        signIn.mockImplementation(() => new Promise(() => {}));
        usePathname.mockReturnValue("/home");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { assign },
        });

        await render(<DemoBar />);
        await act(async () => buttonWithLabel("Cafetería")?.click());
        await act(async () => buttonWithLabel("Cambiar a Cafetería")?.click());

        expect(buttonWithLabel("Cambiando…")?.disabled).toBe(true);
    });

    it("does not show an ops role button", async () => {
        usePathname.mockReturnValue("/home");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { assign },
        });

        await render(<DemoBar />);

        const buttons = [...document.querySelectorAll("button")].map(
            (button) => button.textContent,
        );
        expect(buttons.some((text) => text?.includes("Ops"))).toBe(false);
    });
});
