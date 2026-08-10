"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useElysia } from "@/frontend/lib/eden";

const unwrapResponse = (result: unknown) =>
    (result as { response: unknown }).response;

const showError = (error: unknown) => {
    toast.error(
        error instanceof Error ? error.message : "Ocurrió un error inesperado",
    );
};

const withErrorToast = <T extends object>(options: T) =>
    ({ ...options, onError: showError }) as T;

export const usePlanStatus = (cafeId: string) => {
    const client = useElysia().plans;
    return useQuery({
        ...(client
            .cafes({ cafeId })
            .status.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["plans", cafeId, "status"],
        select: unwrapResponse,
        // The indexer credits the cafe a tick after the receipt lands.
        refetchInterval: 3_000,
    });
};

export const usePlanOrders = (cafeId: string) => {
    const client = useElysia().plans;
    return useQuery({
        ...(client
            .cafes({ cafeId })
            .orders.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["plans", cafeId, "orders"],
        select: unwrapResponse,
        refetchInterval: (query: { state: { data: unknown } }) => {
            const data = query.state.data as
                | { response?: Array<{ status?: string }> }
                | Array<{ status?: string }>
                | undefined;
            const orders = Array.isArray(data) ? data : data?.response;
            return orders?.some(
                (order) =>
                    order.status === "pending" || order.status === "submitted",
            )
                ? 2_000
                : false;
        },
    });
};

export const usePlanOrder = (orderId: string | null) => {
    const client = useElysia().plans;
    return useQuery({
        ...(client
            .orders({ id: orderId ?? "" })
            .get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["plans", "orders", orderId],
        select: unwrapResponse,
        enabled: orderId !== null,
        refetchInterval: 2_000,
    });
};

export const useCreatePlanOrder = (cafeId: string) => {
    const client = useElysia().plans;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client.orders.post.mutationOptions(),
            onSuccess: () =>
                queryClient.invalidateQueries({ queryKey: ["plans", cafeId] }),
        }),
    );
};
