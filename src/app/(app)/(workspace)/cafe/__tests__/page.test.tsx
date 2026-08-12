// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const useMyCafes = vi.fn();
const useCreateCafe = vi.fn();
const searchParamsGet = vi.fn(() => null);

vi.mock("next/navigation", () => ({
    useRouter: () => ({
        push: vi.fn(),
        replace: vi.fn(),
    }),
    useSearchParams: () => ({
        get: (...args: string[]) => searchParamsGet(...args),
    }),
}));
vi.mock("@/core/cafe/client/hooks", () => ({
    useMyCafes: (...args: unknown[]) => useMyCafes(...args),
    useCreateCafe: (...args: unknown[]) => useCreateCafe(...args),
}));
vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({
        children,
        onClick,
        disabled,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
    }) => (
        <button type="button" onClick={onClick} disabled={disabled}>
            {children}
        </button>
    ),
}));
vi.mock("@/core/cafe/client/ui/cafe-form", () => ({
    CafeForm: () => <div>Formulario de café</div>,
}));
vi.mock("@/core/cafe/client/ui/status-badge", () => ({
    StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

import MyCafesPage from "../page";

describe("my cafes page", () => {
    let renderedRoot: ReturnType<typeof createRoot> | undefined;

    afterEach(async () => {
        await act(async () => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        vi.clearAllMocks();
        searchParamsGet.mockReturnValue(null);
    });

    async function renderPage() {
        const container = document.createElement("div");
        document.body.append(container);
        renderedRoot = createRoot(container);
        await act(async () => renderedRoot?.render(<MyCafesPage />));
        return container;
    }

    it("renders guide empty state for no cafes", async () => {
        useMyCafes.mockReturnValue({
            data: [],
            isLoading: false,
            isError: false,
        });
        useCreateCafe.mockReturnValue({
            isPending: false,
            mutateAsync: vi.fn(),
        });

        const container = await renderPage();

        expect(container.textContent).toContain("¿Tienes otra cafetería?");
        expect(container.textContent).toContain(
            "Cada local se registra por separado: catálogo, canjes y fondo común propios.",
        );
        expect(container.querySelector('a[href="/cafe?new=1"]')).not.toBeNull();
    });

    it("shows review explanation for non approved statuses", async () => {
        useMyCafes.mockReturnValue({
            data: [
                {
                    id: "c1",
                    name: "Quinto Café",
                    district: "Lince",
                    onboardingStatus: "submitted",
                },
            ],
            isLoading: false,
            isError: false,
        });
        useCreateCafe.mockReturnValue({
            isPending: false,
            mutateAsync: vi.fn(),
        });

        const container = await renderPage();

        expect(container.textContent).toContain("En revisión.");
        expect(container.textContent).toContain(
            "Operaciones valida tu cafetería y luego podrás operar en la red.",
        );
    });
});
