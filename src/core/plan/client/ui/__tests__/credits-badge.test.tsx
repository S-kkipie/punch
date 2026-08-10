// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const usePlanStatus = vi.fn();
vi.mock("@/core/plan/client/hooks", () => ({
    usePlanStatus: (...args: unknown[]) => usePlanStatus(...args),
}));

import { CreditsBadge } from "../credits-badge";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function renderBadge() {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(<CreditsBadge cafeId="c1" />));
}

describe("CreditsBadge", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("shows the credit count", async () => {
        usePlanStatus.mockReturnValue({
            data: { credits: 42, planActive: true },
            isLoading: false,
        });
        await renderBadge();
        expect(document.body.textContent).toMatch(/42/);
    });

    it("warns when credits run low", async () => {
        usePlanStatus.mockReturnValue({
            data: { credits: 4, planActive: true },
            isLoading: false,
        });
        await renderBadge();
        expect(document.body.textContent).toMatch(/Te quedan pocos créditos/i);
    });

    it("tells the cafe to activate the plan when it has none", async () => {
        usePlanStatus.mockReturnValue({
            data: { credits: 0, planActive: false },
            isLoading: false,
        });
        await renderBadge();
        expect(document.body.textContent).toMatch(/Activa tu plan/i);
    });

    it("renders nothing while loading", async () => {
        usePlanStatus.mockReturnValue({ data: undefined, isLoading: true });
        await renderBadge();
        expect(document.body.textContent).toBe("");
    });
});
