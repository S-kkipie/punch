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
vi.mock("next/link", () => ({
    default: ({ children, ...props }: React.ComponentProps<"a">) => (
        <a {...props}>{children}</a>
    ),
}));
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

    it("shows referrals and estimated origin credit", async () => {
        const { node, root } = await renderPage();

        expect(node.textContent).toContain("Fondo común");
        expect(node.textContent).toContain("3 referencias");
        expect(node.textContent).toContain("S/0.60");
        expect(node.textContent).toContain("estimado");

        await act(async () => root.unmount());
    });

    it("shows an empty message when there are no referrals", async () => {
        state.fund.referrals = 0;
        const { node, root } = await renderPage();

        expect(node.textContent).toContain("Aún sin referencias este mes");

        await act(async () => root.unmount());
    });
});
