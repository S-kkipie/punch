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
        className,
    }: {
        children: React.ReactNode;
        onClick: () => void;
        className?: string;
    }) => (
        <button className={className} type="button" onClick={onClick}>
            {children}
        </button>
    ),
}));
vi.mock("@/frontend/components/ui/input", () => ({
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
        <input {...props} />
    ),
}));
vi.mock("@/frontend/components/guide/journey-card", () => ({
    JourneyCard: ({ currentRole }: { currentRole: string }) => (
        <div data-testid="journey-card">JourneyCard · {currentRole}</div>
    ),
}));

import ScanPage from "../page";

afterEach(() => {
    push.mockReset();
    document.body.innerHTML = "";
});

describe("ScanPage guidance", () => {
    it("renders the three numbered steps and the customer journey card", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<ScanPage />));

        expect(
            container.querySelector('[aria-label="Cómo registrar tu compra"]'),
        ).not.toBeNull();
        expect(container.textContent).toContain("1. Paga tu compra");
        expect(container.textContent).toContain("2. Escanea el código");
        expect(container.textContent).toContain("3. Confirma tu sello");
        expect(
            container.querySelector('[data-testid="journey-card"]')
                ?.textContent,
        ).toContain("cliente");
        await act(async () => root.unmount());
    });
});

describe("ScanPage camera privacy", () => {
    it("waits for explicit intent before requesting camera access", async () => {
        const getUserMedia = vi.fn(async () => ({
            getTracks: () => [{ stop: vi.fn() }],
        }));
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia },
        });
        Object.defineProperty(window, "BarcodeDetector", {
            configurable: true,
            value: class {
                detect = async () => [];
            },
        });
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<ScanPage />));
        expect(getUserMedia).not.toHaveBeenCalled();
        await act(async () =>
            Array.from(container.querySelectorAll("button"))
                .find((candidate) => candidate.textContent === "Abrir cámara")
                ?.click(),
        );
        expect(getUserMedia).toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it("requests camera access again after an acquisition error", async () => {
        const getUserMedia = vi
            .fn()
            .mockRejectedValueOnce(new Error("permission failed"))
            .mockResolvedValue({
                getTracks: () => [{ stop: vi.fn() }],
            });
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia },
        });
        Object.defineProperty(window, "BarcodeDetector", {
            configurable: true,
            value: class {
                detect = async () => [];
            },
        });
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<ScanPage />));

        await act(async () => {
            Array.from(container.querySelectorAll("button"))
                .find((candidate) => candidate.textContent === "Abrir cámara")
                ?.click();
            await Promise.resolve();
        });
        expect(getUserMedia).toHaveBeenCalledTimes(1);

        await act(async () => {
            Array.from(container.querySelectorAll("button"))
                .find(
                    (candidate) =>
                        candidate.textContent === "Reintentar cámara",
                )
                ?.click();
            await Promise.resolve();
        });
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        await act(async () => root.unmount());
    });
});

describe("ScanPage pasted fallback", () => {
    it("navigates to the purchase page when a valid link is opened", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<ScanPage />));

        const input = container.querySelector("input");
        const button = Array.from(container.querySelectorAll("button")).find(
            (candidate) => candidate.textContent === "Abrir",
        );
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
        await act(async () =>
            Array.from(container.querySelectorAll("button"))
                .find((candidate) => candidate.textContent === "Abrir")
                ?.click(),
        );
        expect(push).not.toHaveBeenCalled();
        expect(
            container.querySelector('button[class*="min-h-11"]'),
        ).not.toBeNull();
        await act(async () => root.unmount());
    });
});
