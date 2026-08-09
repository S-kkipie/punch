// @vitest-environment happy-dom

import { act } from "react";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mutate, usePurchaseProof, useConfirmPurchase, usePurchaseOrder } =
    vi.hoisted(() => ({
        mutate: vi.fn(),
        usePurchaseProof: vi.fn(),
        useConfirmPurchase: vi.fn(),
        usePurchaseOrder: vi.fn(),
    }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
    useParams: () => ({ proofId: "proof-123" }),
    useRouter: () => ({ push }),
}));
vi.mock("@/core/consumption/client/hooks", () => ({
    usePurchaseProof,
    useConfirmPurchase,
    usePurchaseOrder,
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
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import PurchaseConfirmPage from "../page";

const proof = {
    id: "proof-123",
    cafeId: "cafe-1",
    productId: "product-1",
    amountCentimos: 1200,
    expiresAt: "2099-08-08T12:00:00.000Z",
    status: "issued",
    maskedYapeRef: "•••••••34",
    purchaseOrderId: null,
    failureReason: null,
    createdAt: "2099-08-08T11:00:00.000Z",
};

const renderPage = async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<PurchaseConfirmPage />));
    return { container, root };
};

afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

beforeEach(() => {
    usePurchaseProof.mockReturnValue({
        isPending: false,
        isError: false,
        data: proof,
    });
    usePurchaseOrder.mockReturnValue({ data: undefined, isError: false });
    useConfirmPurchase.mockReturnValue({ isPending: false, mutate });
});

describe("PurchaseConfirmPage rendered behavior", () => {
    it("shows only the masked Yape reference and disables repeated confirmation", async () => {
        const { container, root } = await renderPage();
        expect(container.textContent).toContain("•••••••34");
        expect(container.textContent).not.toContain("YAPE-1234");
        const button = Array.from(container.querySelectorAll("button")).find(
            (candidate) => candidate.textContent === "Confirmar compra",
        ) as HTMLButtonElement;
        await act(async () => {
            button.click();
            button.click();
        });
        expect(mutate).toHaveBeenCalledTimes(1);
        await act(async () => root.unmount());
    });
    it("shows immediate pending status and removes confirm action before polling", async () => {
        mutate.mockImplementation(
            (
                _input: unknown,
                options: { onSuccess: (result: unknown) => void },
            ) => {
                options.onSuccess({
                    response: {
                        order: { id: "order-123", status: "queued" },
                        quote: {
                            ...proof,
                            status: "submitted",
                            purchaseOrderId: "order-123",
                        },
                        outcome: "created",
                    },
                });
            },
        );
        const { container, root } = await renderPage();

        await act(async () => container.querySelector("button")?.click());

        expect(container.textContent).toContain("Confirmación en cola");
        expect(container.textContent).not.toContain("Confirmar compra");
        await act(async () => root.unmount());
    });

    it("offers recovery when status polling errors", async () => {
        const refetch = vi.fn();
        usePurchaseOrder.mockReturnValue({
            isError: true,
            refetch,
            data: undefined,
        });
        const { container, root } = await renderPage();

        expect(container.textContent).toContain(
            "No pudimos actualizar el estado",
        );
        const retry = Array.from(container.querySelectorAll("button")).find(
            (button) => button.textContent === "Reintentar estado",
        );
        await act(async () => retry?.click());
        expect(refetch).toHaveBeenCalledOnce();
        await act(async () => root.unmount());
    });

    it("renders rejected status and keeps the retry action wired", async () => {
        mutate.mockImplementation(
            (
                _input: unknown,
                options: { onSuccess: (result: unknown) => void },
            ) => {
                options.onSuccess({
                    response: {
                        order: {
                            id: "order-123",
                            status: "failed",
                            failureReason: "No se pudo completar",
                        },
                        quote: {
                            ...proof,
                            status: "submitted",
                            purchaseOrderId: "order-123",
                        },
                        outcome: "existing",
                    },
                });
            },
        );
        const { container, root } = await renderPage();

        await act(async () => container.querySelector("button")?.click());

        expect(container.textContent).toContain("Reintento disponible");
        const retry = Array.from(container.querySelectorAll("button")).find(
            (button) => button.textContent === "Reintentar",
        );
        expect(retry).not.toBeUndefined();
        await act(async () => retry?.click());
        expect(mutate).toHaveBeenCalledTimes(2);
        await act(async () => root.unmount());
    });
});
