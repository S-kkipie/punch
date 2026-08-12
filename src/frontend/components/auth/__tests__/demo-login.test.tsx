// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { assign, signIn } = vi.hoisted(() => ({
    assign: vi.fn(),
    signIn: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock("next/navigation", () => ({}));
vi.mock("@/config/client-config", () => ({
    ClientConfig: { demoMode: true, demoPassword: "demo-password" },
}));
vi.mock("@/frontend/auth/auth", () => ({ authClient: { signIn: { email: signIn } } }));
import { DemoLogin } from "../demo-login";

describe("DemoLogin", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("routes every visible demo role through its dedicated destination", async () => {
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { assign },
        });
        let root = createRoot(document.body);

        await act(async () => root.render(<DemoLogin />));
        const findButtons = () => [...document.querySelectorAll("button")];

        const clientButton = findButtons().find((button) =>
            button.textContent?.includes("Entrar como cliente"),
        );
        const cafeButton = findButtons().find((button) =>
            button.textContent?.includes("Entrar como cafetería"),
        );

        expect(clientButton).not.toBeUndefined();
        expect(cafeButton).not.toBeUndefined();
        expect(findButtons().some((button) => button.textContent?.includes("Ops"))).toBe(
            false,
        );

        await act(async () => clientButton?.click());
        expect(signIn).toHaveBeenCalledWith({
            email: "demo-consumer@punch.pe",
            password: "demo-password",
        });
        expect(assign).toHaveBeenCalledWith("/home");

        await act(async () => {
            root.unmount();
            vi.clearAllMocks();
            document.body.innerHTML = "";
        });

        root = createRoot(document.body);
        await act(async () => root.render(<DemoLogin />));
        const secondCafeButton = findButtons().find((button) =>
            button.textContent?.includes("Entrar como cafetería"),
        );

        await act(async () => secondCafeButton?.click());
        expect(signIn).toHaveBeenCalledWith({
            email: "brujula@punch.pe",
            password: "demo-password",
        });
        expect(assign).toHaveBeenCalledWith("/cafe");

        await act(async () => root.unmount());
    });
});
