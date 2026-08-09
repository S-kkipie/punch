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
            "purchase-proofs": () => ({ get: { queryOptions } }),
            purchases: { confirm: { post: { mutationOptions: queryOptions } } },
        },
        purchases: () => ({ get: { queryOptions } }),
    }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import {
    transactionPollingInterval,
    useConfirmPurchase,
    usePurchaseOrder,
    usePurchaseProof,
    useTransactionStatus,
} from "../hooks";
import {
    purchaseOrderQueryKey,
    purchaseQuoteQueryKey,
} from "../purchase-status";

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

    it("stops quote polling once an order is linked", () => {
        usePurchaseProof("quote-linked");
        const options = useQuery.mock.calls.at(-1)?.[0] as {
            refetchInterval: (query: {
                state: { data: unknown };
            }) => number | false;
        };
        expect(
            options.refetchInterval({
                state: {
                    data: {
                        response: {
                            status: "submitted",
                            purchaseOrderId: "order-1",
                        },
                    },
                },
            }),
        ).toBe(false);
    });

    it("polls quote only while it is non-terminal", () => {
        usePurchaseProof("quote-1");
        const options = useQuery.mock.calls.at(-1)?.[0] as {
            refetchInterval: (query: {
                state: { data: unknown };
            }) => number | false;
        };
        expect(
            options.refetchInterval({ state: { data: { status: "issued" } } }),
        ).toBe(3000);
        expect(
            options.refetchInterval({
                state: { data: { status: "submitted" } },
            }),
        ).toBe(3000);
        expect(
            options.refetchInterval({
                state: { data: { status: "confirmed" } },
            }),
        ).toBe(false);
        expect(
            options.refetchInterval({ state: { data: { status: "failed" } } }),
        ).toBe(false);
        expect(
            options.refetchInterval({ state: { data: { status: "expired" } } }),
        ).toBe(false);
    });

    it("refreshes economics when order polling reaches a terminal state", () => {
        usePurchaseOrder("order-polled");
        const options = useQuery.mock.calls.at(-1)?.[0] as {
            refetchInterval: (query: {
                state: { data: unknown };
            }) => number | false;
        };
        options.refetchInterval({ state: { data: { status: "confirmed" } } });
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ["punch", "dashboard"],
        });
    });

    it("seeds the returned quote and order and refreshes economics only after terminal confirmation", () => {
        const mutation = useConfirmPurchase() as unknown as {
            onSuccess: (result: unknown) => void;
        };
        const order = { id: "order-2", status: "confirmed" };
        const quote = { id: "quote-2", status: "submitted" };
        mutation.onSuccess({ response: { order, quote, outcome: "existing" } });
        expect(setQueryData).toHaveBeenCalledWith(
            purchaseOrderQueryKey("order-2"),
            { response: order },
        );
        expect(setQueryData).toHaveBeenCalledWith(
            purchaseQuoteQueryKey("quote-2"),
            { response: quote },
        );
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ["punch", "dashboard"],
        });
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: purchaseQuoteQueryKey("quote-2"),
        });
    });

    it("does not refresh economics while the order is queued", () => {
        invalidateQueries.mockClear();
        const mutation = useConfirmPurchase() as unknown as {
            onSuccess: (result: unknown) => void;
        };
        mutation.onSuccess({
            response: {
                order: { id: "order-3", status: "queued" },
                quote: { id: "quote-3", status: "submitted" },
                outcome: "created",
            },
        });
        expect(invalidateQueries).not.toHaveBeenCalledWith({
            queryKey: ["punch", "dashboard"],
        });
    });
});
