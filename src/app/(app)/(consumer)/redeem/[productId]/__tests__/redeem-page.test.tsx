// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { punchMutate, voucherMutate, useSearchParams } = vi.hoisted(() => ({
    punchMutate: vi.fn(),
    voucherMutate: vi.fn(),
    useSearchParams: vi.fn(),
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
    useDashboard: () => ({ isPending: false, data: { balance: 12 } }),
    useVouchers: () => ({
        isPending: false,
        data: [
            {
                id: "voucher-1",
                source: "campaign",
                status: "redeemed",
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
        vi.clearAllMocks();
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
});
