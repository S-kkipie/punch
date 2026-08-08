// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { punchMutate, voucherMutate, txState, inboxData } = vi.hoisted(() => ({
    punchMutate: vi.fn(),
    voucherMutate: vi.fn(),
    txState: new Map<string, { status: string }>(),
    inboxData: [
        { id: "punch-1", kind: "punch_reward", status: "pending" },
        { id: "voucher-1", kind: "voucher", status: "pending" },
    ],
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ cafeId: "cafe-1" }) }));
vi.mock("@/core/consumption/client/hooks", () => ({
    useCafeRedemptionInbox: () => ({
        isPending: false,
        data: inboxData,
    }),
    useDecidePunchRedemption: () => ({ isPending: false, mutate: punchMutate }),
    useDecideVoucherRedemption: () => ({
        isPending: false,
        mutate: voucherMutate,
    }),
    useTransactionStatus: (id: string) => ({
        data: id ? txState.get(id) : undefined,
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
}));
vi.mock("@/frontend/components/ui/input", () => ({
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
        <input {...props} />
    ),
}));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import CafeRedemptionsPage from "../page";

describe("café redemption settlement lifecycle", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
        txState.clear();
        inboxData.splice(
            0,
            inboxData.length,
            { id: "punch-1", kind: "punch_reward", status: "pending" },
            { id: "voucher-1", kind: "voucher", status: "pending" },
        );
    });

    it("keeps PUNCH and voucher decisions distinct and renders pending then terminal retry state", async () => {
        punchMutate.mockImplementation(
            (
                _body: unknown,
                options: { onSuccess: (result: unknown) => void },
            ) =>
                options.onSuccess({
                    response: { transactionId: "tx-punch", status: "pending" },
                }),
        );
        voucherMutate.mockImplementation(
            (
                _body: unknown,
                options: { onSuccess: (result: unknown) => void },
            ) =>
                options.onSuccess({
                    response: {
                        transactionId: "tx-voucher",
                        status: "pending",
                    },
                }),
        );
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<CafeRedemptionsPage />));
        const approve = [...container.querySelectorAll("button")].filter(
            (button) => button.textContent === "Aprobar",
        );
        await act(async () => {
            approve[0]?.click();
            approve[1]?.click();
        });
        expect(punchMutate).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: "punch-1" }),
            expect.any(Object),
        );
        expect(voucherMutate).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: "voucher-1" }),
            expect.any(Object),
        );
        expect(container.textContent).toContain("Pendiente on-chain");
        inboxData.splice(0, inboxData.length, {
            id: "punch-1",
            kind: "punch_reward",
            status: "pending",
        });
        txState.set("tx-punch", { status: "confirmed" });
        txState.set("tx-voucher", { status: "failed" });
        await act(async () => root.render(<CafeRedemptionsPage />));
        expect(container.textContent).toContain("Uso de voucher");
        expect(container.textContent).toContain("Reintento disponible");
        const retry = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "Reintentar",
        );
        await act(async () => retry?.click());
        expect(voucherMutate).toHaveBeenCalledTimes(2);
        expect(punchMutate).toHaveBeenCalledTimes(1);
        await act(async () => root.unmount());
    });
});
