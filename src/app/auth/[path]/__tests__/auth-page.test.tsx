// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const clientConfig = vi.hoisted(() => ({
    demoMode: true,
    demoPassword: "demo-password",
}));

vi.mock("@/config/client-config", () => ({
    ClientConfig: clientConfig,
}));
vi.mock("@/frontend/components/auth/demo-login", () => ({
    DemoLogin: () => <div data-testid="demo-login">demo block</div>,
}));
vi.mock("@/frontend/components/auth/auth", () => ({
    Auth: ({ path }: { path: string }) => (
        <div data-testid={`auth-${path}`}>auth form</div>
    ),
}));

import { AuthPageClient } from "../auth-page";

describe("AuthPageClient", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        clientConfig.demoMode = true;
        vi.clearAllMocks();
    });

    it("renders demo login above a collapsible email form in demo mode", async () => {
        const root = createRoot(document.body);
        await act(async () => root.render(<AuthPageClient path="sign-in" />));

        expect(
            document.querySelector("[data-testid='demo-login']"),
        ).not.toBeNull();
        const details = document.querySelector("details");
        const summary = document.querySelector("summary");
        expect(details).not.toBeNull();
        expect(summary?.textContent).toBe("Tengo una cuenta");
        expect(
            details?.querySelector("[data-testid='auth-sign-in']"),
        ).not.toBeNull();

        const nodes = [...document.querySelectorAll("*")];
        const detailsIndex = nodes.findIndex(
            (node) => node.tagName === "DETAILS",
        );
        const loginIndex = nodes.findIndex(
            (node) => node.getAttribute("data-testid") === "demo-login",
        );
        expect(loginIndex).toBeLessThan(detailsIndex);

        await act(async () => root.unmount());
    });

    it("does not show the email/password details in non-demo mode", async () => {
        clientConfig.demoMode = false;
        const root = createRoot(document.body);

        await act(async () => root.render(<AuthPageClient path="sign-in" />));

        expect(document.querySelector("[data-testid='demo-login']")).toBeNull();
        expect(document.querySelector("details")).toBeNull();
        expect(
            document.querySelector("[data-testid='auth-sign-in']"),
        ).not.toBeNull();

        await act(async () => root.unmount());
    });
});
