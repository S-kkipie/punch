import { describe, expect, it, vi } from "vitest";

const { useQuery, queryOptions } = vi.hoisted(() => ({
    useQuery: vi.fn((options: Record<string, unknown>) => options),
    queryOptions: vi.fn(() => ({})),
}));

vi.mock("@tanstack/react-query", () => ({
    useQuery,
    useMutation: vi.fn(),
    useQueryClient: vi.fn(),
}));
vi.mock("@/frontend/lib/eden", () => ({
    useElysia: () => ({
        plans: {
            cafes: () => ({
                orders: { get: { queryOptions } },
            }),
        },
    }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { usePlanOrders } from "../hooks";

describe("usePlanOrders polling", () => {
    it("polls while payment history contains an in-flight order and stops once terminal", () => {
        usePlanOrders("cafe-1");
        const options = useQuery.mock.calls.at(-1)?.[0] as {
            refetchInterval: (query: {
                state: { data: unknown };
            }) => number | false;
        };

        expect(
            options.refetchInterval({
                state: {
                    data: { response: [{ status: "pending" }] },
                },
            }),
        ).toBe(2_000);
        expect(
            options.refetchInterval({
                state: {
                    data: { response: [{ status: "submitted" }] },
                },
            }),
        ).toBe(2_000);
        expect(
            options.refetchInterval({
                state: {
                    data: { response: [{ status: "confirmed" }] },
                },
            }),
        ).toBe(false);
    });
});
