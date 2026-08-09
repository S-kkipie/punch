// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { toCanvas, mutate } = vi.hoisted(() => ({
    toCanvas: vi.fn(),
    mutate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ cafeId: "cafe-1" }) }));
vi.mock("qrcode", () => ({ default: { toCanvas } }));
vi.mock("@/core/cafe/client/hooks", () => ({
    useCafeProducts: () => ({
        isPending: false,
        isError: false,
        data: [
            {
                id: "product-1",
                name: "Espresso",
                type: "emission",
                approvalStatus: "approved",
                active: true,
            },
        ],
    }),
}));
vi.mock("@/core/consumption/client/hooks", () => ({
    useCreatePurchaseProof: () => ({
        data: { response: { deepLink: "/purchase/proof-1" } },
        isPending: false,
        mutate,
    }),
}));
vi.mock("@/core/plan/client/hooks", () => ({
    usePlanStatus: () => ({ data: undefined, isLoading: true }),
}));
vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({
        children,
        onClick,
        disabled,
    }: {
        children: React.ReactNode;
        onClick: () => void;
        disabled?: boolean;
    }) => (
        <button type="button" onClick={onClick} disabled={disabled}>
            {children}
        </button>
    ),
}));
vi.mock("@/frontend/components/ui/card", () => ({
    Card: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    CardContent: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    CardHeader: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    CardTitle: ({ children }: { children: React.ReactNode }) => (
        <h2>{children}</h2>
    ),
}));
vi.mock("@/frontend/components/ui/select", () => ({
    Select: ({
        children,
        onValueChange,
        value,
    }: {
        children: React.ReactNode;
        onValueChange?: (value: string) => void;
        value?: string;
    }) => (
        <select
            aria-label="Producto de emisión"
            value={value}
            onChange={(event) => onValueChange?.(event.target.value)}
        >
            {children}
        </select>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    SelectValue: ({ placeholder }: { placeholder: string }) => (
        <span>{placeholder}</span>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    SelectItem: ({
        children,
        value,
    }: {
        children: React.ReactNode;
        value: string;
    }) => <option value={value}>{children}</option>,
}));

import CafeTerminalPage from "../page";

describe("CafeTerminalPage", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("does not submit a fabricated Yape reference", () => {
        const source = readFileSync(
            "src/app/(app)/(workspace)/cafe/[cafeId]/terminal/page.tsx",
            "utf8",
        );
        expect(source).not.toContain("UI_PENDING");
    });

    it("submits the reference and clears it after issuing the QR", async () => {
        mutate.mockImplementation(
            (_input: unknown, options?: { onSuccess?: () => void }) =>
                options?.onSuccess?.(),
        );
        const root = createRoot(document.body);
        await act(async () => root.render(<CafeTerminalPage />));
        const select = document.querySelector("select") as HTMLSelectElement;
        const input = document.querySelector(
            'input[aria-label="Referencia Yape"]',
        ) as HTMLInputElement;
        await act(async () => {
            select.value = "product-1";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )?.set;
            valueSetter?.call(input, "YAPE-1234");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => document.querySelector("button")?.click());
        expect(mutate).toHaveBeenCalledWith(
            { productId: "product-1", yapeRef: "YAPE-1234" },
            expect.anything(),
        );
        expect(document.body.textContent).not.toContain("YAPE-1234");
        await act(async () => root.unmount());
    });

    it("rejects a Yape reference longer than 120 characters before submitting", async () => {
        const root = createRoot(document.body);
        await act(async () => root.render(<CafeTerminalPage />));
        const select = document.querySelector("select") as HTMLSelectElement;
        const input = document.querySelector(
            'input[aria-label="Referencia Yape"]',
        ) as HTMLInputElement;
        const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
        )?.set;
        await act(async () => {
            select.value = "product-1";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            valueSetter?.call(input, "x".repeat(121));
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(document.querySelector("button")?.hasAttribute("disabled")).toBe(
            true,
        );
        expect(input.maxLength).toBe(120);
        await act(async () => root.unmount());
    });

    it("unwraps the raw Eden response and renders an absolute QR link", async () => {
        const root = createRoot(document.body);
        await act(async () => root.render(<CafeTerminalPage />));
        expect(document.body.textContent).toContain("/purchase/proof-1");
        expect(toCanvas).toHaveBeenCalledWith(
            expect.any(HTMLCanvasElement),
            "http://localhost:3000/purchase/proof-1",
        );
        await act(async () => root.unmount());
    });
});
