// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { punchMutate, voucherMutate, txState, inboxData, txError } = vi.hoisted(
    () => ({
        punchMutate: vi.fn(),
        voucherMutate: vi.fn(),
        txState: new Map<
            string,
            {
                status: string;
                txHash?: string;
                blockNumber?: number;
                rejectionReason?: string;
            }
        >(),
        txError: { value: false },
        inboxData: [
            {
                id: "punch-1",
                kind: "punch_reward",
                status: "pending",
                productName: "Cappuccino clásico",
                consumerName: "Consumidor Demo",
                reimbursementAmount: "2.80",
                createdAt: new Date(Date.now() - 1000 * 40).toISOString(),
            } as {
                id: string;
                kind: string;
                status: string;
                transactionId?: string;
                transactionStatus?: string;
                failureReason?: string;
                rejectionReason?: string;
                productName?: string;
                consumerName?: string;
                reimbursementAmount?: string;
                createdAt?: string;
            },
        ],
    }),
);

vi.mock("next/navigation", () => ({
    useParams: () => ({ cafeId: "cafe-1" }),
}));
vi.mock("@/core/consumption/client/hooks", () => ({
    useCafeRedemptionInbox: () => ({
        isPending: false,
        data: inboxData,
    }),
    useDecidePunchRedemption: () => ({
        isPending: false,
        mutate: punchMutate,
    }),
    useDecideVoucherRedemption: () => ({
        isPending: false,
        mutate: voucherMutate,
    }),
    useTransactionStatus: (id: string) => ({
        data: id ? txState.get(id) : undefined,
        isError: txError.value,
        refetch: () => undefined,
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
vi.mock("@/frontend/components/ui/input", () => ({
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
        <input {...props} />
    ),
}));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));
vi.mock("@/frontend/components/guide/journey-card", () => ({
    JourneyCard: () => <div data-testid="journey-card" />,
}));
vi.mock("@/frontend/components/guide/page-intro", () => ({
    PageIntro: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/frontend/components/guide/stat", () => ({
    Stat: ({ value, label }: { value: string; label: string }) => (
        <div>
            {label}: {value}
        </div>
    ),
}));
vi.mock("@/frontend/components/guide/empty-state", () => ({
    EmptyState: ({ title, cause }: { title: string; cause: string }) => (
        <div>
            {title}
            {cause}
        </div>
    ),
}));

import CafeRedemptionsPage from "../page";

describe("café redemption inbox guide", () => {
    const originalChain = process.env.NEXT_PUBLIC_CHAIN_ENV;

    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
        txState.clear();
        txError.value = false;
        inboxData.splice(0, inboxData.length, {
            id: "punch-1",
            kind: "punch_reward",
            status: "pending",
            productName: "Cappuccino clásico",
            consumerName: "Consumidor Demo",
            reimbursementAmount: "2.80",
            createdAt: new Date(Date.now() - 1000 * 40).toISOString(),
        });
        process.env.NEXT_PUBLIC_CHAIN_ENV = originalChain;
    });

    it("hides reject reason input until Rechazar is pressed", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(<CafeRedemptionsPage />);
        });

        expect(
            container.querySelector('input[aria-label="Motivo del rechazo"]'),
        ).toBeNull();

        const rejectButton = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "Rechazar",
        );
        await act(async () => rejectButton?.click());

        expect(
            container.querySelector('input[aria-label="Motivo del rechazo"]'),
        ).not.toBeNull();
        expect(container.textContent).toContain("Confirmar rechazo");

        await act(async () => root.unmount());
    });

    it("shows product, consumer and refund line per row", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(<CafeRedemptionsPage />);
        });

        expect(container.textContent).toContain("Cappuccino clásico");
        expect(container.textContent).toContain("Consumidor Demo");
        expect(container.textContent).toContain("te reembolsan S/2.80");

        await act(async () => root.unmount());
    });

    it("maps settlement states into ChainReceipt states for on-chain flow", async () => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
        punchMutate.mockImplementation(
            (
                _body: unknown,
                options: { onSuccess: (result: unknown) => void },
            ) =>
                options.onSuccess({
                    response: {
                        status: "pending",
                        transactionId: "tx-punch",
                    },
                }),
        );

        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(<CafeRedemptionsPage />);
        });

        const approveButton = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "Entregar",
        );
        await act(async () => approveButton?.click());

        expect(container.textContent).toContain("Preparando la operación");

        txState.set("tx-punch", {
            status: "submitted",
            txHash: "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92",
        });
        await act(async () => {
            await root.render(<CafeRedemptionsPage />);
        });
        expect(container.textContent).toContain("Confirmando en la cadena");
        expect(container.querySelector("a")?.getAttribute("href")).toContain(
            "/tx/0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92",
        );

        txState.set("tx-punch", {
            status: "confirmed",
            txHash: "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92",
            blockNumber: 12345,
        });
        await act(async () => {
            await root.render(<CafeRedemptionsPage />);
        });
        expect(container.textContent).toContain("Confirmado en Arbitrum");

        txState.set("tx-punch", {
            status: "failed",
            txHash: "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92",
            rejectionReason: "Fondos insuficientes del relayer",
        });
        await act(async () => {
            await root.render(<CafeRedemptionsPage />);
        });

        expect(container.textContent).toContain(
            "No se pudo escribir en la cadena",
        );
        const retry = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "Reintentar",
        );
        expect(retry).toBeDefined();
        await act(async () => retry?.click());
        expect(punchMutate).toHaveBeenCalledTimes(2);

        await act(async () => root.unmount());
    });

    it("renders refetched remote settlement and handles polling errors", async () => {
        inboxData.splice(0, inboxData.length, {
            id: "punch-1",
            kind: "punch_reward",
            status: "approved",
            transactionId: "tx-punch",
            productName: "Cappuccino clásico",
            consumerName: "Luis M.",
            transactionStatus: "pending",
            rejectionReason: "No corresponde",
        });

        txState.set("tx-punch", { status: "pending" });
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(<CafeRedemptionsPage />);
        });

        expect(container.textContent).toContain("Preparando la operación");
        txState.set("tx-punch", {
            status: "failed",
            rejectionReason: "INSUFFICIENT_BALANCE",
        });
        await act(async () => {
            await root.render(<CafeRedemptionsPage />);
        });
        expect(container.textContent).toContain(
            "No se pudo escribir en la cadena",
        );

        txError.value = true;
        inboxData.splice(0, inboxData.length, {
            id: "failed-remote",
            kind: "punch_reward",
            status: "failed",
            transactionId: "tx-fail",
            transactionStatus: "failed",
            failureReason: "No se pudo completar",
            productName: "Cappuccino clásico",
            consumerName: "Ana R.",
        });
        txState.set("tx-fail", {
            status: "failed",
            rejectionReason: "No se pudo consultar",
        });
        await act(async () => {
            await root.render(<CafeRedemptionsPage />);
        });
        expect(container.textContent).toContain(
            "No se pudo consultar el estado del canje.",
        );

        await act(async () => root.unmount());
    });
});
