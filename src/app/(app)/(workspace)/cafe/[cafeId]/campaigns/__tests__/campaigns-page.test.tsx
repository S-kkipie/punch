// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    campaigns: [] as unknown[],
    // Saldo de la billetera del café: financiar sale de aquí.
    walletBalance: "1000000000",
    create: vi.fn(),
    fund: vi.fn(),
    publish: vi.fn(),
    cancel: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ cafeId: "cafe-1" }) }));
vi.mock("@/core/campaign/client/hooks", () => ({
    useCafeCampaigns: () => ({
        isPending: false,
        isError: false,
        data: {
            campaigns: state.campaigns,
            walletBalance: state.walletBalance,
        },
    }),
    useCreateCampaign: () => ({ isPending: false, mutate: state.create }),
    useFundCampaign: () => ({ isPending: false, mutate: state.fund }),
    usePublishCampaign: () => ({ isPending: false, mutate: state.publish }),
    useCancelCampaign: () => ({ isPending: false, mutate: state.cancel }),
}));
vi.mock("@/frontend/components/ui/button", () => ({
    Button: (props: React.ComponentProps<"button">) => <button {...props} />,
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
    Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import CafeCampaignsPage from "../page";

// Montos en unidades base de mPEN (6 decimales): S/3.00 por voucher × 4.
const campaign = (overrides: Record<string, unknown> = {}) => ({
    id: "campaign-1",
    name: "Campaña",
    voucherPayout: "3000000",
    maxVouchers: 4,
    required: "12000000",
    funded: "4000000",
    missing: "8000000",
    canPublish: false,
    lifecycle: "draft",
    chainOps: [] as unknown[],
    windowStart: "2026-08-09T00:00:00.000Z",
    windowEnd: "2026-08-10T00:00:00.000Z",
    ...overrides,
});

describe("café campaigns screen", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        state.campaigns = [];
        state.walletBalance = "1000000000";
        vi.clearAllMocks();
    });
    it("previews required budget from payout times cap", async () => {
        const rootNode = document.createElement("div");
        document.body.append(rootNode);
        const root = createRoot(rootNode);
        await act(async () => root.render(<CafeCampaignsPage />));
        const inputs = rootNode.querySelectorAll("input");
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )?.set?.call(inputs[1], "3");
            inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )?.set?.call(inputs[2], "4");
            inputs[2].dispatchEvent(new Event("input", { bubbles: true }));
        });
        // El preview convierte soles a soles: S/3.00 × 4 = S/12.00.
        expect(rootNode.textContent).toContain("S/12.00");
        await act(async () => root.unmount());
    });
    it("refuses a window that already ended instead of failing on chain", async () => {
        // El contrato revierte con ExpiryInPast recién al publicar, cuando la
        // campaña ya está creada y financiada.
        const node = document.createElement("div");
        document.body.append(node);
        const root = createRoot(node);
        await act(async () => root.render(<CafeCampaignsPage />));
        const inputs = [...node.querySelectorAll("input")];
        const setValue = (input: HTMLInputElement, value: string) => {
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )?.set?.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        await act(async () => {
            setValue(inputs[0], "Campaña vencida");
            setValue(inputs[1], "5");
            setValue(inputs[2], "10");
            setValue(inputs[3], "2020-01-01T10:00");
            setValue(inputs[4], "2020-02-01T10:00");
        });
        await act(async () =>
            [...node.querySelectorAll("button")]
                .find((button) => button.textContent === "Crear campaña")
                ?.click(),
        );
        expect(node.textContent).toContain("La fecha de fin ya pasó");
        expect(state.create).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it("renders creating without publish", async () => {
        state.campaigns = [campaign({ lifecycle: "creating" })];
        const node = document.createElement("div");
        document.body.append(node);
        const root = createRoot(node);
        await act(async () => root.render(<CafeCampaignsPage />));
        expect(node.textContent).toContain("Creando campaña on-chain");
        expect(node.textContent).not.toContain("Publicar campaña");
        await act(async () => root.unmount());
    });
    it("shows missing funding and disables publish", async () => {
        state.campaigns = [campaign()];
        const node = document.createElement("div");
        document.body.append(node);
        const root = createRoot(node);
        await act(async () => root.render(<CafeCampaignsPage />));
        expect(node.textContent).toContain("Faltan S/8.00");
        expect(
            [...node.querySelectorAll("button")].find(
                (button) => button.textContent === "Publicar campaña",
            )?.disabled,
        ).toBe(true);
        await act(async () => root.unmount());
    });
    it("blocks funding the wallet cannot cover and says why", async () => {
        // El caso real: la campaña pide S/50.00 y la billetera tiene S/3.60.
        // Antes el clic encolaba el job, `transferFrom` revertía on-chain y la
        // pantalla no mostraba absolutamente nada.
        state.walletBalance = "3600000";
        state.campaigns = [campaign()];
        const node = document.createElement("div");
        document.body.append(node);
        const root = createRoot(node);
        await act(async () => root.render(<CafeCampaignsPage />));
        const fundingInput = [...node.querySelectorAll("input")].find((input) =>
            input.getAttribute("aria-label")?.startsWith("Monto en soles"),
        ) as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )?.set?.call(fundingInput, "50");
            fundingInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const fundButton = [...node.querySelectorAll("button")].find(
            (button) => button.textContent === "Financiar",
        ) as HTMLButtonElement;
        expect(node.textContent).toContain("Tu billetera tiene S/3.60");
        expect(fundButton.disabled).toBe(true);
        await act(async () => fundButton.click());
        expect(state.fund).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it("confirms on screen that the funding left for the chain", async () => {
        state.campaigns = [campaign()];
        state.fund.mockImplementation(
            (_variables: unknown, options: { onSuccess?: () => void }) =>
                options?.onSuccess?.(),
        );
        const node = document.createElement("div");
        document.body.append(node);
        const root = createRoot(node);
        await act(async () => root.render(<CafeCampaignsPage />));
        const fundingInput = [...node.querySelectorAll("input")].find((input) =>
            input.getAttribute("aria-label")?.startsWith("Monto en soles"),
        ) as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )?.set?.call(fundingInput, "8");
            fundingInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () =>
            [...node.querySelectorAll("button")]
                .find((button) => button.textContent === "Financiar")
                ?.click(),
        );
        expect(state.fund).toHaveBeenCalled();
        expect(node.textContent).toContain("S/8.00 en camino al contrato");
        await act(async () => root.unmount());
    });

    it("asks before cancelling, then says what comes back", async () => {
        state.campaigns = [campaign({ funded: "200000000" })];
        state.cancel.mockImplementation(
            (_id: unknown, options: { onSuccess?: () => void }) =>
                options?.onSuccess?.(),
        );
        const node = document.createElement("div");
        document.body.append(node);
        const root = createRoot(node);
        await act(async () => root.render(<CafeCampaignsPage />));

        const openConfirm = [...node.querySelectorAll("button")].find(
            (button) =>
                button.textContent === "Cancelar y recuperar el presupuesto",
        ) as HTMLButtonElement;
        await act(async () => openConfirm.click());
        // Devolver dinero no se dispara con un solo clic accidental.
        expect(state.cancel).not.toHaveBeenCalled();
        expect(node.textContent).toContain("te devuelve S/200.00");

        await act(async () =>
            [...node.querySelectorAll("button")]
                .find((button) =>
                    button.textContent?.startsWith("Sí, cancelar"),
                )
                ?.click(),
        );
        expect(state.cancel).toHaveBeenCalledWith(
            "campaign-1",
            expect.anything(),
        );
        expect(node.textContent).toContain("Cancelación enviada");
        await act(async () => root.unmount());
    });

    it("keeps the budget when the owner backs out", async () => {
        state.campaigns = [campaign()];
        const node = document.createElement("div");
        document.body.append(node);
        const root = createRoot(node);
        await act(async () => root.render(<CafeCampaignsPage />));
        await act(async () =>
            [...node.querySelectorAll("button")]
                .find(
                    (button) =>
                        button.textContent ===
                        "Cancelar y recuperar el presupuesto",
                )
                ?.click(),
        );
        await act(async () =>
            [...node.querySelectorAll("button")]
                .find((button) => button.textContent === "Mejor no")
                ?.click(),
        );
        expect(state.cancel).not.toHaveBeenCalled();
        expect(node.textContent).not.toContain("te devuelve");
        await act(async () => root.unmount());
    });

    it("enables publish when fully funded", async () => {
        state.campaigns = [
            campaign({ funded: "12000000", missing: "0", canPublish: true }),
        ];
        const node = document.createElement("div");
        document.body.append(node);
        const root = createRoot(node);
        await act(async () => root.render(<CafeCampaignsPage />));
        expect(
            [...node.querySelectorAll("button")].find(
                (button) => button.textContent === "Publicar campaña",
            )?.disabled,
        ).toBe(false);
        await act(async () => root.unmount());
    });
});
