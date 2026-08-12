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
    dashboardBalance,
    cafesData,
} = vi.hoisted(() => ({
    punchMutate: vi.fn(),
    voucherMutate: vi.fn(),
    useSearchParams: vi.fn(),
    voucherStatus: { value: "redeemed" as string },
    dashboardBalance: { value: 12 as number | null },
    cafesData: {
        value: [
            {
                id: "cafe-1",
                name: "Brújula Café",
                district: "Miraflores",
                lat: "-12.043",
                lng: "-77.029",
                slug: "brujula-cafe",
                description: null,
                address: null,
                onboardingStatus: "approved",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
            {
                id: "cafe-2",
                name: "Patio 9",
                district: "Barranco",
                lat: "-12.043",
                lng: "-76.980",
                slug: "patio-9",
                description: null,
                address: null,
                onboardingStatus: "approved",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
            {
                id: "cafe-3",
                name: "Nube Tostada",
                district: "San Isidro",
                lat: "-12.043",
                lng: "-77.005",
                slug: "nube-tostada",
                description: null,
                address: null,
                onboardingStatus: "approved",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
            {
                id: "cafe-4",
                name: "Esquina Sur",
                district: "Surquillo",
                lat: "-12.043",
                lng: "-76.990",
                slug: "esquina-sur",
                description: null,
                address: null,
                onboardingStatus: "approved",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
            {
                id: "cafe-5",
                name: "Lejano",
                district: "La Molina",
                lat: "-13.200",
                lng: "-77.000",
                slug: "lejano",
                description: null,
                address: null,
                onboardingStatus: "approved",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ],
    },
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
    useCafes: () => ({
        isPending: false,
        data: cafesData.value,
    }),
}));
vi.mock("@/core/punch/client/hooks", () => ({
    useDashboard: () => ({
        isPending: false,
        data: {
            balance: dashboardBalance.value,
            stale: dashboardBalance.value === null,
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
    useHistory: () => ({ data: [], isPending: false }),
    useRequestPunchRedemption: () => ({
        isPending: false,
        mutate: punchMutate,
    }),
    useRequestVoucherRedemption: () => ({
        isPending: false,
        mutate: voucherMutate,
    }),
}));
vi.mock("@/frontend/components/guide/journey-card", () => ({
    JourneyCard: ({ currentRole }: { currentRole: string }) => (
        <div data-testid="journey-card">JourneyCard · {currentRole}</div>
    ),
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

import * as discoveryDistance from "@/frontend/components/consumer/discovery-distance";
import RedeemPage from "../page";

describe("RedeemPage voucher safety", () => {
    const sortCafesByDistance = vi.spyOn(
        discoveryDistance,
        "sortCafesByDistance",
    );

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
        dashboardBalance.value = 12;
        useSearchParams.mockReset();
        punchMutate.mockReset();
        voucherMutate.mockReset();
        sortCafesByDistance.mockClear();
        cafesData.value = cafesData.value.slice(0);
    });

    it("renders a readable invalid-link state without cafeId", async () => {
        useSearchParams.mockReturnValue(new URLSearchParams());
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));
        expect(container.textContent).toContain("enlace de canje no es válido");
        expect(container.textContent).toContain("falta la cafetería");
        expect(punchMutate).not.toHaveBeenCalled();
        await act(async () => root.unmount());
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

    it("shows blocked CTA and singular reason at 11 stamps", async () => {
        dashboardBalance.value = 11;
        useSearchParams.mockReturnValue(new URLSearchParams("cafeId=cafe-1"));
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));
        expect(
            (container.querySelector("button") as HTMLButtonElement).disabled,
        ).toBe(true);
        expect(container.textContent).toContain("Canjear · te falta 1 sello");
        await act(async () => root.unmount());
    });

    it("uses plural reason for larger shortfalls", async () => {
        dashboardBalance.value = 10;
        useSearchParams.mockReturnValue(new URLSearchParams("cafeId=cafe-1"));
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));
        expect(
            (container.querySelector("button") as HTMLButtonElement).disabled,
        ).toBe(true);
        expect(container.textContent).toContain("Canjear · te faltan 2 sellos");
        await act(async () => root.unmount());
    });

    it("enables eligible PUNCH redemption", async () => {
        dashboardBalance.value = 12;
        useSearchParams.mockReturnValue(new URLSearchParams("cafeId=cafe-1"));
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));
        expect(
            (container.querySelector("button") as HTMLButtonElement).disabled,
        ).toBe(false);
        expect(container.textContent).toContain("Canjear 12 PUNCH");
        await act(async () => root.unmount());
    });

    it("rejects stale vouchers without showing PUNCH redemption or submitting", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));

        expect(container.textContent).toContain("Voucher no disponible");
        expect(container.textContent).not.toContain("Canjear ·");
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

    it("shows the four nearest network cafés in order", async () => {
        dashboardBalance.value = 12;
        useSearchParams.mockReturnValue(new URLSearchParams("cafeId=cafe-1"));

        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<RedeemPage />));

        const listItems = Array.from(
            container.querySelectorAll("li[data-cafe-id]"),
        ).map((item) => item.getAttribute("data-cafe-id"));
        expect(listItems).toHaveLength(4);
        expect(listItems).toEqual(["cafe-1", "cafe-3", "cafe-4", "cafe-2"]);
        expect(container.textContent).not.toContain("Lejano");
        expect(sortCafesByDistance).toHaveBeenCalledTimes(1);
        expect(sortCafesByDistance).toHaveBeenCalledWith(cafesData.value, {
            lat: -12.043,
            lng: -77.029,
        });
        await act(async () => root.unmount());
    });
});
