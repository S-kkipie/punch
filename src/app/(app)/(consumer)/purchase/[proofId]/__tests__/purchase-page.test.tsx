// @vitest-environment happy-dom

import { act } from "react";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mutate, usePurchaseProof, useConfirmPurchase, useTransactionStatus } =
    vi.hoisted(() => ({
        mutate: vi.fn(),
        usePurchaseProof: vi.fn(),
        useConfirmPurchase: vi.fn(),
        useTransactionStatus: vi.fn(),
    }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
    useParams: () => ({ proofId: "proof-123" }),
    useRouter: () => ({ push }),
}));
vi.mock("@/core/consumption/client/hooks", () => ({
    usePurchaseProof,
    useConfirmPurchase,
    useTransactionStatus,
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
    amountCentimos: 1200,
    expiresAt: "2099-08-08T12:00:00.000Z",
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
    useTransactionStatus.mockReturnValue({ data: undefined });
    useConfirmPurchase.mockReturnValue({ isPending: false, mutate });
});

describe("PurchaseConfirmPage rendered behavior", () => {
    it("shows immediate pending status and removes confirm action before polling", async () => {
        mutate.mockImplementation(
            (
                _input: unknown,
                options: { onSuccess: (result: unknown) => void },
            ) => {
                options.onSuccess({
                    response: { transactionId: "tx-123", status: "pending" },
                });
            },
        );
        const { container, root } = await renderPage();

        await act(async () => container.querySelector("button")?.click());

        expect(container.textContent).toContain("Pendiente on-chain");
        expect(container.textContent).not.toContain("Confirmar compra");
        await act(async () => root.unmount());
    });

    it("offers recovery when status polling errors", async () => {
        const refetch = vi.fn();
        useTransactionStatus.mockReturnValue({
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
                        transactionId: "tx-123",
                        status: "failed",
                        rejectionReason: "No se pudo completar",
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
