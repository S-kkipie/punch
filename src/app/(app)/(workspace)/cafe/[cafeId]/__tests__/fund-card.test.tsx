// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    fund: {
        epoch: 202608,
        referrals: 3,
        pendingCreditMpen: "600000",
        estimated: true,
        buckets: {
            origin: "4000000",
            acquisition: "3000000",
            crawl: "2000000",
            contingency: "1000000",
        },
    },
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ cafeId: "cafe-1" }) }));
vi.mock("@/core/cafe/client/hooks", () => ({
    useCafe: () => ({
        isPending: false,
        isFetching: false,
        isError: false,
        data: {
            id: "cafe-1",
            name: "Brújula",
            onboardingStatus: "approved",
        },
    }),
    useCafeProducts: () => ({
        isPending: false,
        isFetching: false,
        data: [],
    }),
    useCafeFund: () => ({
        isPending: false,
        isFetching: false,
        isError: false,
        data: state.fund,
    }),
    useCreateProduct: () => ({ isPending: false, mutate: vi.fn() }),
    useSubmitCafe: () => ({
        isPending: false,
        mutate: vi.fn(),
        error: null,
    }),
    useUpdateCafe: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/core/cafe/client/ui/cafe-form", () => ({ CafeForm: () => null }));
vi.mock("@/core/cafe/client/ui/product-form", () => ({
    ProductForm: () => null,
}));
vi.mock("@/core/cafe/client/ui/product-list", () => ({
    ProductList: () => null,
}));
vi.mock("@/core/cafe/client/ui/status-badge", () => ({
    StatusBadge: () => null,
}));
vi.mock("@/core/consumption/client/hooks", () => ({
    useCafePayouts: () => ({ data: undefined }),
}));
vi.mock("@/core/plan/client/ui/credits-badge", () => ({
    CreditsBadge: () => null,
}));
vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({ children }: { children: React.ReactNode }) => (
        <button type="button">{children}</button>
    ),
}));
vi.mock("@/frontend/components/ui/card", () => ({
    Card: ({ children }: { children: React.ReactNode }) => (
        <section>{children}</section>
    ),
    CardContent: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    CardHeader: ({ children }: { children: React.ReactNode }) => (
        <header>{children}</header>
    ),
    CardTitle: ({ children }: { children: React.ReactNode }) => (
        <h2>{children}</h2>
    ),
}));
vi.mock("@/frontend/components/ui/spinner", () => ({
    Spinner: () => <span>Cargando</span>,
}));
vi.mock("@/frontend/components/guide/journey-card", () => ({
    JourneyCard: ({ currentRole }: { currentRole: string }) => (
        <div>JourneyCard · {currentRole}</div>
    ),
}));

import CafePanelPage from "../page";

async function renderPage() {
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    await act(async () => root.render(<CafePanelPage />));
    return { node, root };
}

describe("café common fund card", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        state.fund.referrals = 3;
        vi.clearAllMocks();
    });

    it("renders fund as guided stats with bucket explanations", async () => {
        const { node, root } = await renderPage();

        expect(node.textContent).toContain("Tu cafetería en la red");
        expect(node.textContent).toContain("Fondo común · tu parte");
        expect(node.textContent).toContain("S/0.60");
        expect(node.textContent).toContain(
            "Época 202608 · 3 referencias este mes · estimado",
        );
        expect(node.textContent).toContain(
            "Clientes que entraron a la red por tu cafetería",
        );
        expect(node.textContent).toContain("Campañas que trajeron gente nueva");
        expect(node.textContent).toContain('Tu paso en "Vuelta por Barranco"');
        expect(node.textContent).toContain("Reserva de la red");
        expect(node.textContent).toContain("JourneyCard · cafeteria");

        const stats = node.querySelectorAll(".guide-stat");
        expect(stats.length).toBe(5);

        await act(async () => root.unmount());
    });

    it("handles zero referrals in the fund bucket lead line", async () => {
        state.fund.referrals = 0;
        const { node, root } = await renderPage();

        expect(node.textContent).toContain("Sin referencias este mes");

        await act(async () => root.unmount());
    });
});
