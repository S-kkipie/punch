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
let container: HTMLDivElement | undefined;

async function render(ui: React.ReactNode) {
    if (!container) {
        container = document.createElement("div");
        document.body.append(container);
    }

    if (!renderedRoot) {
        renderedRoot = createRoot(container);
    }

    await act(async () => {
        renderedRoot?.render(ui);
    });
}

function roleButton(label: string) {
    return [...document.querySelectorAll(".demo-bar__role-btn")].find(
        (button) => button.textContent?.includes(label),
    ) as HTMLButtonElement | undefined;
}

function switchButtons() {
    return [
        ...document.querySelectorAll<HTMLElement>(".demo-bar__switch button"),
    ];
}

describe("DemoBar", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        if (container) {
            container.innerHTML = "";
        }
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

    it("renders the compact strip with pressed role pills", async () => {
        usePathname.mockReturnValue("/home");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { assign },
        });

        await render(<DemoBar />);

        const bar = document.querySelector(".demo-bar");
        expect(bar).not.toBeNull();

        const buttons = switchButtons();
        expect(buttons).toHaveLength(2);
        expect(
            buttons.map((button) => button.getAttribute("aria-pressed")),
        ).toEqual(["true", "false"]);
        expect(
            document
                .querySelector(".demo-bar__actions")
                ?.querySelector(".demo-only"),
        ).not.toBeNull();
    });

    it("derives the active role from the pathname", async () => {
        usePathname.mockReturnValue("/home");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { assign },
        });

        await render(<DemoBar />);

        expect(roleButton("Cliente")?.disabled).toBe(true);
        expect(roleButton("Cliente")?.getAttribute("aria-pressed")).toBe(
            "true",
        );

        usePathname.mockReturnValue("/ops");
        await render(<DemoBar />);

        expect(roleButton("Cafetería")?.disabled).toBe(true);
        expect(roleButton("Cafetería")?.getAttribute("aria-pressed")).toBe(
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
        await act(async () => roleButton("Cafetería")?.click());

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
        await act(async () => roleButton("Cafetería")?.click());
        const confirm = [
            ...document.querySelectorAll<HTMLElement>(
                ".demo-bar__panel .demo-bar__confirm",
            ),
        ][0] as HTMLButtonElement | undefined;
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
        await act(async () => roleButton("Cafetería")?.click());
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

function buttonWithLabel(label: string) {
    return [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(label),
    ) as HTMLButtonElement | undefined;
}
