// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    campaigns: [] as unknown[],
    create: vi.fn(),
    fund: vi.fn(),
    publish: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ cafeId: "cafe-1" }) }));
vi.mock("@/core/campaign/client/hooks", () => ({
    useCafeCampaigns: () => ({
        isPending: false,
        isError: false,
        data: state.campaigns,
    }),
    useCreateCampaign: () => ({ isPending: false, mutate: state.create }),
    useFundCampaign: () => ({ isPending: false, mutate: state.fund }),
    usePublishCampaign: () => ({ isPending: false, mutate: state.publish }),
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

const campaign = (overrides: Record<string, unknown> = {}) => ({
    id: "campaign-1",
    name: "Campaña",
    voucherPayout: "3",
    maxVouchers: 4,
    required: "12",
    funded: "4",
    missing: "8",
    canPublish: false,
    lifecycle: "draft",
    windowStart: "2026-08-09T00:00:00.000Z",
    windowEnd: "2026-08-10T00:00:00.000Z",
    ...overrides,
});

describe("café campaigns screen", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        state.campaigns = [];
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
        expect(rootNode.textContent).toContain("12");
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
        expect(node.textContent).toContain("Faltan 8");
        expect(
            [...node.querySelectorAll("button")].find(
                (button) => button.textContent === "Publicar campaña",
            )?.disabled,
        ).toBe(true);
        await act(async () => root.unmount());
    });
    it("enables publish when fully funded", async () => {
        state.campaigns = [
            campaign({ funded: "12", missing: "0", canPublish: true }),
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
