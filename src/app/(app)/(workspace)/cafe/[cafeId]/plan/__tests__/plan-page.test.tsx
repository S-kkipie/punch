// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const usePlanStatus = vi.fn();
const usePlanOrders = vi.fn();
const useCreatePlanOrder = vi.fn();

vi.mock("next/navigation", () => ({ useParams: () => ({ cafeId: "c1" }) }));
vi.mock("@/core/plan/client/hooks", () => ({
    usePlanStatus: (...args: unknown[]) => usePlanStatus(...args),
    usePlanOrders: (...args: unknown[]) => usePlanOrders(...args),
    usePlanOrder: () => ({ data: undefined }),
    useCreatePlanOrder: (...args: unknown[]) => useCreatePlanOrder(...args),
}));

import PlanPage, { calculateWeeksAtCurrentPace } from "../page";

function setup(status: Record<string, unknown>, orders: unknown[] = []) {
    usePlanStatus.mockReturnValue({ data: status, isLoading: false });
    usePlanOrders.mockReturnValue({ data: orders, isLoading: false });
    useCreatePlanOrder.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function renderPage() {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(<PlanPage />));
}

function button(name: RegExp) {
    return [...document.querySelectorAll("button")].find((element) =>
        name.test(
            `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""}`,
        ),
    ) as HTMLButtonElement | undefined;
}

describe("plan page", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("offers to activate the plan when it is inactive", async () => {
        setup({
            cafeId: "c1",
            planActive: false,
            credits: 0,
            unallocatedReserveSoles: 0,
            canPay: true,
            inFlightOrderId: null,
        });
        await renderPage();
        expect(button(/Activar plan/i)?.disabled).toBe(false);
        expect(document.body.textContent).toMatch(/S\/49/);
    });

    it("offers a pack once the plan is active and shows credits and reserve", async () => {
        setup({
            cafeId: "c1",
            planActive: true,
            credits: 87,
            unallocatedReserveSoles: 26.1,
            canPay: true,
            inFlightOrderId: null,
        });
        await renderPage();
        expect(button(/Comprar pack/i)?.disabled).toBe(false);
        expect(document.body.textContent).toContain("87");
        expect(document.body.textContent).toMatch(/26\.10/);
    });

    it("explains that credits do not expire", async () => {
        setup({
            cafeId: "c1",
            planActive: true,
            credits: 10,
            unallocatedReserveSoles: 3,
            canPay: true,
            inFlightOrderId: null,
        });
        await renderPage();
        expect(document.body.textContent).toMatch(/no vencen/i);
    });

    it("blocks the button while a payment is in flight", async () => {
        setup({
            cafeId: "c1",
            planActive: false,
            credits: 0,
            unallocatedReserveSoles: 0,
            canPay: true,
            inFlightOrderId: "o1",
        });
        await renderPage();
        expect(button(/Activar plan/i)?.disabled).toBe(true);
    });

    it("hides the button and explains when the wallet is not authorized", async () => {
        setup({
            cafeId: "c1",
            planActive: false,
            credits: 0,
            unallocatedReserveSoles: 0,
            canPay: false,
            inFlightOrderId: null,
        });
        await renderPage();
        expect(button(/Activar plan/i)).toBeUndefined();
        expect(document.body.textContent).toMatch(/no está autorizada/i);
    });

    it("blocks payment while PUNCH verifies an unresolved payment", async () => {
        setup({
            cafeId: "c1",
            planActive: false,
            credits: 0,
            unallocatedReserveSoles: 0,
            canPay: true,
            inFlightOrderId: null,
            needsReconciliation: true,
        });
        await renderPage();
        expect(button(/Activar plan/i)).toBeUndefined();
        expect(document.body.textContent).toMatch(/PUNCH está verificando/i);
    });

    it("lists past payments", async () => {
        setup(
            {
                cafeId: "c1",
                planActive: true,
                credits: 100,
                unallocatedReserveSoles: 30,
                canPay: true,
                inFlightOrderId: null,
            },
            [
                {
                    id: "o1",
                    cafeId: "c1",
                    kind: "plan",
                    priceSoles: 49,
                    status: "confirmed",
                    failureReason: null,
                    txHash: "0xdead",
                    createdAt: "2026-08-09T00:00:00.000Z",
                },
            ],
        );
        await renderPage();
        expect(document.body.textContent).toMatch(/Plan/);
        expect(document.body.textContent).toMatch(/0xdead/);
    });
});

describe("calculateWeeksAtCurrentPace", () => {
    it("derives weeks left from confirmed history", () => {
        const weeks = calculateWeeksAtCurrentPace(150, [
            {
                createdAt: "2026-01-01T00:00:00.000Z",
                kind: "plan",
                status: "confirmed",
            },
            {
                createdAt: "2026-01-15T00:00:00.000Z",
                kind: "pack",
                status: "confirmed",
            },
            {
                createdAt: "2026-01-29T00:00:00.000Z",
                kind: "plan",
                status: "confirmed",
            },
        ]);

        expect(weeks).toBe(4);
    });

    it("returns null when history is too short", () => {
        expect(
            calculateWeeksAtCurrentPace(80, [
                {
                    createdAt: "2026-01-01T00:00:00.000Z",
                    kind: "plan",
                    status: "confirmed",
                },
            ]),
        ).toBeNull();
    });

    it("returns null when burn is zero", () => {
        expect(
            calculateWeeksAtCurrentPace(200, [
                {
                    createdAt: "2026-01-01T00:00:00.000Z",
                    kind: "plan",
                    status: "confirmed",
                },
                {
                    createdAt: "2026-01-15T00:00:00.000Z",
                    kind: "plan",
                    status: "confirmed",
                },
            ]),
        ).toBeNull();
    });
});
