// @vitest-environment happy-dom

import { act } from "react";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    mutate,
    useDashboard,
    usePurchaseProof,
    useConfirmPurchase,
    usePurchaseOrder,
} = vi.hoisted(() => ({
    mutate: vi.fn(),
    useDashboard: vi.fn(),
    usePurchaseProof: vi.fn(),
    useConfirmPurchase: vi.fn(),
    usePurchaseOrder: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useParams: () => ({ proofId: "proof-123" }),
    useRouter: () => ({ push }),
}));

vi.mock("@/core/punch/client/hooks", () => ({
    useDashboard,
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

import PurchaseConfirmPage from "@/core/consumption/client/ui/purchase-confirm-page";

const HASH =
    "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92";

type MockProof = {
    id: string;
    cafeId: string;
    productId: string;
    amountCentimos: number;
    expiresAt: string;
    status: "issued" | "submitted" | "confirmed" | "failed" | "expired";
    maskedYapeRef: string;
    purchaseOrderId: string | null;
    failureReason: string | null;
    createdAt: string;
};

type MockOrder = {
    id: string;
    status:
        | "user_confirmed"
        | "cafe_confirmed"
        | "queued"
        | "submitted"
        | "confirmed"
        | "failed"
        | "expired";
    failureReason?: string | null;
    txHash?: string | null;
};

const proofBase: MockProof = {
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

let proof: MockProof = { ...proofBase };
let order: MockOrder | undefined;
let dashboardBalance: number | null = 11;

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
    usePurchaseProof.mockReset();
    usePurchaseOrder.mockReset();
    useDashboard.mockReset();
    useConfirmPurchase.mockReset();
    proof = { ...proofBase };
    order = undefined;
    dashboardBalance = 11;
    process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
});

beforeEach(() => {
    process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
    usePurchaseProof.mockImplementation(() => ({
        isPending: false,
        isError: false,
        data: proof,
    }));
    usePurchaseOrder.mockImplementation(() => ({
        data: order,
        isError: false,
    }));
    useDashboard.mockImplementation(() => ({
        isPending: false,
        isError: false,
        data: {
            balance: dashboardBalance,
            stale: dashboardBalance === null,
        },
    }));
    useConfirmPurchase.mockReturnValue({ isPending: false, mutate });
});

describe("PurchaseConfirmPage rendered behavior", () => {
    it("resumes polling an order linked by the safe quote after a reload", async () => {
        proof = {
            ...proof,
            status: "submitted",
            purchaseOrderId: "order-123",
        };
        await renderPage();
        expect(usePurchaseOrder).toHaveBeenCalledWith("order-123");
    });

    it("re-enables confirmation after a transient mutation failure", async () => {
        mutate.mockImplementation(
            (_input: unknown, options: { onError: () => void }) =>
                options.onError(),
        );
        const { container, root } = await renderPage();
        await act(async () => container.querySelector("button")?.click());
        expect(container.textContent).toContain("Confirmar y sellar");
        expect(
            (container.querySelector("button") as HTMLButtonElement).disabled,
        ).toBe(false);
        await act(async () => root.unmount());
    });

    it("clears a previous linked order when navigating to an unlinked quote", async () => {
        proof = {
            ...proof,
            status: "issued",
            purchaseOrderId: "order-old",
        };
        order = {
            id: "order-old",
            status: "confirmed",
            txHash: HASH,
        };
        proof = {
            ...proof,
            purchaseOrderId: null,
        };
        order = undefined;
        const { container, root } = await renderPage();
        await act(async () => root.render(<PurchaseConfirmPage />));
        expect(container.textContent).toContain("Confirmar y sellar");
        expect(container.textContent).toContain(
            "Al confirmar quedarás en 12/12",
        );
        await act(async () => root.unmount());
    });

    it("shows only the masked Yape reference and allows one confirmation click", async () => {
        const { container, root } = await renderPage();
        expect(container.textContent).toContain("•••••••34");
        expect(container.textContent).not.toContain("YAPE-1234");
        const button = Array.from(container.querySelectorAll("button")).find(
            (candidate) => candidate.textContent === "Confirmar y sellar",
        ) as HTMLButtonElement;

        await act(async () => {
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
                        order: {
                            id: "order-123",
                            status: "queued",
                        },
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

        expect(container.textContent).toContain("Preparando la operación");
        expect(container.textContent).not.toContain("Confirmar y sellar");
        await act(async () => root.unmount());
    });

    it("offers recovery when status polling errors", async () => {
        const refetch = vi.fn();
        usePurchaseOrder.mockImplementation(() => ({
            isError: true,
            refetch,
            data: undefined,
        }));
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

    it("renders failed status and shows the chain receipt failure reason", async () => {
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

        expect(container.textContent).toContain("No se pudo completar");
        expect(container.textContent).not.toContain("Reintentar");
        expect(mutate).toHaveBeenCalledTimes(1);
        await act(async () => root.unmount());
    });

    it("shows the balance consequence line for 11/12 before confirming", async () => {
        dashboardBalance = 11;
        const { container, root } = await renderPage();
        expect(container.textContent).toContain(
            "Al confirmar quedarás en 12/12",
        );
        await act(async () => root.unmount());
    });

    it("maps a pre-confirm state without hash to ChainReceipt queued state", async () => {
        proof = {
            ...proof,
            status: "submitted",
            purchaseOrderId: "order-123",
        };
        order = {
            id: "order-123",
            status: "user_confirmed",
            txHash: null,
        };

        const { container, root } = await renderPage();

        expect(container.textContent).toContain("Preparando la operación");
        expect(document.querySelector("a")).toBeNull();
        await act(async () => root.unmount());
    });

    it("maps a pre-confirm state with hash to ChainReceipt submitted state", async () => {
        proof = {
            ...proof,
            status: "submitted",
            purchaseOrderId: "order-123",
        };
        order = {
            id: "order-123",
            status: "user_confirmed",
            txHash: HASH,
        };

        const { container, root } = await renderPage();

        expect(container.textContent).toContain("Confirmando en la cadena");
        expect(document.querySelector("a")?.getAttribute("href")).toBe(
            `https://sepolia.arbiscan.io/tx/${HASH}`,
        );
        await act(async () => root.unmount());
    });

    it("maps confirmed state to ChainReceipt confirmed with hash", async () => {
        order = {
            id: "order-123",
            status: "confirmed",
            txHash: HASH,
        };

        const { container, root } = await renderPage();

        expect(container.textContent).toContain("Confirmado en Arbitrum");
        expect(document.querySelector("a")?.getAttribute("href")).toBe(
            `https://sepolia.arbiscan.io/tx/${HASH}`,
        );
        expect(container.textContent).toContain("Sello 12 de 12");
        await act(async () => root.unmount());
    });
});
