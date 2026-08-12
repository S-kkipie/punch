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
vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    ),
}));

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
        const root = createRoot(document.body);
        await act(async () => root.render(<DemoLogin />));

        const buttons = [...document.querySelectorAll("button")];
        const consumerButton = buttons.find((button) =>
            button.textContent?.includes("Cliente"),
        );
        const cafeButton = buttons.find((button) =>
            button.textContent?.includes("Cafetería"),
        );

        expect(consumerButton).not.toBeUndefined();
        expect(cafeButton).not.toBeUndefined();
        expect(buttons.some((button) => button.textContent?.includes("Ops"))).toBe(
            false,
        );

        await act(async () => consumerButton?.click());
        expect(signIn).toHaveBeenCalledWith({
            email: "demo-consumer@punch.pe",
            password: "demo-password",
        });
        expect(assign).toHaveBeenCalledWith("/home");

        vi.clearAllMocks();
        await act(async () => cafeButton?.click());
        expect(signIn).toHaveBeenCalledWith({
            email: "brujula@punch.pe",
            password: "demo-password",
        });
        expect(assign).toHaveBeenCalledWith("/cafe");

        await act(async () => root.unmount());
    });
});
