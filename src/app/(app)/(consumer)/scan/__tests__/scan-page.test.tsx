// @vitest-environment happy-dom

import { act } from "react";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push }),
}));
vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({
        children,
        onClick,
    }: {
        children: React.ReactNode;
        onClick: () => void;
    }) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    ),
}));
vi.mock("@/frontend/components/ui/input", () => ({
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
        <input {...props} />
    ),
}));

import ScanPage from "../page";

afterEach(() => {
    push.mockReset();
    document.body.innerHTML = "";
});

describe("ScanPage pasted fallback", () => {
    it("navigates to the purchase page when a valid link is opened", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<ScanPage />));

        const input = container.querySelector("input");
        const button = container.querySelector("button");
        expect(input).not.toBeNull();
        expect(button).not.toBeNull();
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )?.set;
            setter?.call(input, "https://punch.test/purchase/proof-123");
            input?.dispatchEvent(new Event("input", { bubbles: true }));
            button?.click();
        });

        expect(push).toHaveBeenCalledWith("/purchase/proof-123");
        await act(async () => root.unmount());
    });

    it("does not navigate for an empty value", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<ScanPage />));
        await act(async () => container.querySelector("button")?.click());
        expect(push).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });
});
