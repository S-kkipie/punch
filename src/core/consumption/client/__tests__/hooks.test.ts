import { describe, expect, it, vi } from "vitest";

const { useQuery, useMutation, queryOptions, setQueryData } = vi.hoisted(
    () => ({
        useQuery: vi.fn((options: Record<string, unknown>) => options),
        useMutation: vi.fn((options: Record<string, unknown>) => options),
        queryOptions: vi.fn(() => ({})),
        setQueryData: vi.fn(),
    }),
);
const invalidateQueries = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() =>
    vi.fn(() => ({ setQueryData, invalidateQueries })),
);
vi.mock("@tanstack/react-query", () => ({
    useQuery,
    useMutation,
    useQueryClient,
}));
vi.mock("@/frontend/lib/eden", () => ({
    useElysia: () => ({
        consumption: {
            transactions: () => ({ get: { queryOptions } }),
            purchases: { confirm: { post: { mutationOptions: queryOptions } } },
        },
    }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import {
    transactionPollingInterval,
    useConfirmPurchase,
    useTransactionStatus,
} from "../hooks";

describe("useTransactionStatus polling", () => {
    it("passes café context directly so Eden serializes cafeId as a query parameter", () => {
        queryOptions.mockClear();
        useTransactionStatus("tx-1", "cafe-1");
        expect(queryOptions).toHaveBeenCalledWith({ cafeId: "cafe-1" });
    });

    it("polls raw pending responses and stops for terminal responses", () => {
        useTransactionStatus("tx-1");
        const options = useQuery.mock.calls[0]?.[0] as {
            refetchInterval: (query: {
                state: { data: unknown };
            }) => number | false;
        };

        expect(
            options.refetchInterval({
                state: { data: { response: { status: "pending" } } },
            }),
        ).toBe(2000);
        expect(
            options.refetchInterval({
                state: { data: { response: { status: "confirmed" } } },
            }),
        ).toBe(false);
        expect(transactionPollingInterval({ state: { data: undefined } })).toBe(
            false,
        );
    });

    it("seeds the exact transaction cache after confirmation", () => {
        const mutation = useConfirmPurchase() as unknown as {
            onSuccess: (result: unknown) => void;
        };
        mutation.onSuccess({
            response: { transactionId: "tx-2", status: "pending" },
        });
        expect(setQueryData).toHaveBeenCalledWith(
            ["consumption", "transactions", "tx-2"],
            { response: { transactionId: "tx-2", status: "pending" } },
        );
    });
});
