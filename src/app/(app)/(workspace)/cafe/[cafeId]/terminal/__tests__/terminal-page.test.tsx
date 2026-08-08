// @vitest-environment happy-dom
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
    Select: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
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
    SelectItem: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
}));

import CafeTerminalPage from "../page";

describe("CafeTerminalPage", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
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
