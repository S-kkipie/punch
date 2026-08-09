// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const {
    punchMutate,
    voucherMutate,
    useSearchParams,
    voucherStatus,
    chainMode,
    dashboardBalance,
} = vi.hoisted(() => ({
    punchMutate: vi.fn(),
    voucherMutate: vi.fn(),
    useSearchParams: vi.fn(),
    voucherStatus: { value: "redeemed" as string },
    chainMode: { value: "mock" as "mock" | "local" },
    dashboardBalance: { value: 12 as number | null },
}));
vi.mock("next/navigation", () => ({
    useParams: () => ({ productId: "product-1" }),
    useSearchParams,
}));
vi.mock("@/core/cafe/client/hooks", () => ({
    useCafeProducts: () => ({
        isPending: false,
        data: [{ id: "product-1", name: "Americano" }],
    }),
}));
vi.mock("@/core/punch/client/hooks", () => ({
    useDashboard: () => ({
        isPending: false,
        data: {
            balance: dashboardBalance.value,
            stale: dashboardBalance.value === null,
            chainMode: chainMode.value,
        },
    }),
    useVouchers: () => ({
        isPending: false,
        data: [
            {
                id: "voucher-1",
                source: "campaign",
                status: voucherStatus.value,
                cafeId: "cafe-1",
            },
        ],
    }),
}));
vi.mock("@/core/consumption/client/hooks", () => ({
    useRequestPunchRedemption: () => ({
        isPending: false,
        mutate: punchMutate,
    }),
    useRequestVoucherRedemption: () => ({
        isPending: false,
        mutate: voucherMutate,
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
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import RedeemPage from "../page";

describe("RedeemPage voucher safety", () => {
    beforeEach(() => {
        useSearchParams.mockReturnValue(
            new URLSearchParams(
                "cafeId=cafe-1&voucherId=voucher-1&source=campaign",
            ),
        );
    });
    afterEach(() => {
        document.body.innerHTML = "";
        voucherStatus.value = "redeemed";
        chainMode.value = "mock";
        dashboardBalance.value = 12;
        vi.clearAllMocks();
    });

    it("retains the last known balance when a refresh becomes unknown", async () => {
        dashboardBalance.value = 11;
        useSearchParams.mockReturnValue(new URLSearchParams("cafeId=cafe-1"));
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));
        dashboardBalance.value = null;
        await act(async () => root.render(<RedeemPage />));
        expect(container.textContent).toContain("11 / 12");
        expect(container.textContent).toContain("Actualizando desde la cadena");
        await act(async () => root.unmount());
    });

    it("does not present an unknown balance as zero", async () => {
        dashboardBalance.value = null;
        useSearchParams.mockReturnValue(new URLSearchParams("cafeId=cafe-1"));
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));
        expect(container.textContent).not.toContain("Tu progreso: 0 / 12");
        await act(async () => root.unmount());
    });

    it("disables PUNCH redemption in local chain mode with an explanation", async () => {
        chainMode.value = "local";
        useSearchParams.mockReturnValue(new URLSearchParams("cafeId=cafe-1"));
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));
        expect(
            (container.querySelector("button") as HTMLButtonElement).disabled,
        ).toBe(true);
        expect(container.textContent).toMatch(
            /redención on-chain aún no disponible/i,
        );
        await act(async () => root.unmount());
    });

    it("rejects stale vouchers without showing PUNCH redemption or submitting", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));

        expect(container.textContent).toContain("Voucher no disponible");
        expect(container.textContent).not.toContain("Necesitas 12 PUNCH");
        await act(async () => container.querySelector("button")?.click());
        expect(punchMutate).not.toHaveBeenCalled();
        expect(voucherMutate).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it("disables a valid voucher and avoids mutation after going offline", async () => {
        voucherStatus.value = "available";
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));
        await act(async () => window.dispatchEvent(new Event("offline")));
        expect(container.textContent).toContain("Vuelve a conectarte");
        expect(
            (container.querySelector("button") as HTMLButtonElement).disabled,
        ).toBe(true);
        await act(async () => container.querySelector("button")?.click());
        expect(voucherMutate).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });
});
