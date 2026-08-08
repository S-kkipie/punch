// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { push, signIn } = vi.hoisted(() => ({
    push: vi.fn(),
    signIn: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/config/client-config", () => ({
    ClientConfig: { demoMode: true, demoPassword: "demo-password" },
}));
vi.mock("@/frontend/auth/auth", () => ({ authClient: { signIn: { email: signIn } } }));
vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
        <button type="button" onClick={onClick}>{children}</button>
    ),
}));

import { DemoLogin } from "../demo-login";

describe("DemoLogin", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("routes every successful demo role through role-aware home", async () => {
        const root = createRoot(document.body);
        await act(async () => root.render(<DemoLogin />));
        const buttons = [...document.querySelectorAll("button")];
        await act(async () => buttons[0]?.click());
        expect(signIn).toHaveBeenCalledWith({ email: "demo-consumer@punch.pe", password: "demo-password" });
        expect(push).toHaveBeenCalledWith("/home");
        await act(async () => root.unmount());
    });
});
