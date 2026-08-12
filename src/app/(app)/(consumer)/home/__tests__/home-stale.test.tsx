// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const replace = vi.hoisted(() => vi.fn());
const myCafesState = vi.hoisted(() => ({
    data: [] as Array<{ id: string; onboardingStatus: string }>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/core/cafe/client/hooks", () => ({
    useMyCafes: () => ({ isPending: false, data: myCafesState.data }),
}));
vi.mock("@/frontend/auth/auth", () => ({
    authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
const dashboardState = vi.hoisted(() => ({
    data: {
        balance: 11 as number | null,
        stale: true,
        progress: { numerator: 11, denominator: 12 as 12 },
        activeCampaign: null,
        activeCrawl: null,
    },
}));
vi.mock("@/core/punch/client/hooks", () => ({
    useDashboard: () => ({
        isPending: false,
        isError: false,
        data: dashboardState.data,
    }),
}));
vi.mock("@/core/punch/client/ui/punch-meter", () => ({
    PunchMeter: ({ balance }: { balance: number }) => (
        <span>{balance} / 12</span>
    ),
}));
vi.mock("@/frontend/components/guide/journey-card", () => ({
    JourneyCard: () => <span>JourneyCard</span>,
}));
vi.mock("@/frontend/components/consumer/offline-snapshot", () => ({
    readPunchSnapshot: vi.fn(),
    writePunchSnapshot: vi.fn(),
}));
vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({ children }: { children: React.ReactNode }) => (
        <button type="button">{children}</button>
    ),
}));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));

import HomePage from "../page";

describe("HomePage chain staleness", () => {
    it("renders the guided intro and keeps last known balance when stale refresh becomes unknown", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<HomePage />));
        expect(container.querySelector("h1")?.textContent).toBe(
            "Hola de nuevo",
        );
        expect(container.textContent).toContain(
            "Cada compra en una cafetería aliada te da un sello. Con 12 sellos canjeas un café — y la red de cafeterías lo respalda en la cadena.",
        );
        expect(container.textContent).toContain("JourneyCard");
        dashboardState.data = {
            ...dashboardState.data,
            balance: null,
            stale: true,
        };
        await act(async () => root.render(<HomePage />));
        expect(container.textContent).toContain("11 / 12");
        expect(container.textContent).not.toContain("0 / 12");
        await act(async () => root.unmount());
    });

    it("retains the known balance and announces chain refresh", async () => {
        dashboardState.data = { ...dashboardState.data, balance: 11 };
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => root.render(<HomePage />));
        expect(container.textContent).toContain("Actualizando desde la cadena");
        expect(container.textContent).toContain("11 / 12");
        await act(async () => root.unmount());
    });

    it("does not redirect when the user has an approved workspace", async () => {
        myCafesState.data = [{ id: "cafe-1", onboardingStatus: "approved" }];
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);

        await act(async () => root.render(<HomePage />));

        expect(replace).not.toHaveBeenCalled();
        expect(container.textContent).toContain("11 / 12");
        expect(container.textContent).not.toContain("Cargando");

        await act(async () => root.unmount());
    });
});
