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

export const useCafes = () => {
    const client = useElysia().cafes;
    return useQuery({
        ...(client.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["cafes"],
        select: unwrapResponse,
    });
};

export const useMyCafes = () => {
    const client = useElysia().cafes;
    return useQuery({
        ...(client.my.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["cafes", "my"],
        select: unwrapResponse,
    });
};

export const useCafe = (id: string) => {
    const client = useElysia().cafes;
    return useQuery({
        ...(client({ id }).get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["cafes", id],
        select: unwrapResponse,
    });
};

export const useCafeFund = (cafeId: string) => {
    const client = useElysia();
    return useQuery({
        ...(client
            .cafe({ cafeId })
            .fund.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["cafe-fund", cafeId],
        select: unwrapResponse,
        refetchInterval: 5000,
        enabled: Boolean(cafeId),
    });
};

export const useCreateCafe = () => {
    const client = useElysia().cafes;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client.post.mutationOptions(),
            onSuccess: () =>
                queryClient.invalidateQueries({ queryKey: ["cafes"] }),
        }),
    );
};

export const useUpdateCafe = (id: string) => {
    const client = useElysia().cafes;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client({ id }).patch.mutationOptions(),
            onSuccess: () => {
                void queryClient.invalidateQueries({ queryKey: ["cafes"] });
                void queryClient.invalidateQueries({ queryKey: ["cafes", id] });
            },
        }),
    );
};

export const useSubmitCafe = (id: string) => {
    const client = useElysia().cafes;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client({ id }).submit.post.mutationOptions(),
            onSuccess: () => {
                void queryClient.invalidateQueries({ queryKey: ["cafes"] });
                void queryClient.invalidateQueries({ queryKey: ["cafes", id] });
            },
        }),
    );
};

export const useReviewCafe = (id: string) => {
    const client = useElysia().cafes;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client({ id }).review.post.mutationOptions(),
            onSuccess: () => {
                void queryClient.invalidateQueries({ queryKey: ["cafes"] });
                void queryClient.invalidateQueries({ queryKey: ["cafes", id] });
                void queryClient.invalidateQueries({
                    queryKey: ["cafes", "review-queue"],
                });
            },
        }),
    );
};

export const useCafeProducts = (cafeId: string) => {
    const client = useElysia().cafes;
    return useQuery({
        ...(client({
            id: cafeId,
        }).products.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["cafes", cafeId, "products"],
        enabled: Boolean(cafeId),
        select: unwrapResponse,
    });
};

export const useCreateProduct = (cafeId: string) => {
    const client = useElysia().cafes;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client({ id: cafeId }).products.post.mutationOptions(),
            onSuccess: () => {
                void queryClient.invalidateQueries({
                    queryKey: ["cafes", cafeId, "products"],
                });
                void queryClient.invalidateQueries({
                    queryKey: ["products", "pending"],
                });
            },
        }),
    );
};

export const useUpdateProduct = (cafeId: string) => {
    const client = useElysia().cafes;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            mutationFn: async (variables: {
                productId: string;
                [key: string]: unknown;
            }) => {
                const { productId, ...body } = variables;
                return client
                    .products({ productId })
                    .patch.mutationOptions()
                    .mutationFn(body as never);
            },
            onSuccess: () => {
                void queryClient.invalidateQueries({
                    queryKey: ["cafes", cafeId, "products"],
                });
                void queryClient.invalidateQueries({
                    queryKey: ["products", "pending"],
                });
            },
        }),
    );
};

export const useReviewProduct = () => {
    const client = useElysia().cafes;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            mutationFn: async (variables: {
                productId: string;
                [key: string]: unknown;
            }) => {
                const { productId, ...body } = variables;
                return client
                    .products({ productId })
                    .review.post.mutationOptions()
                    .mutationFn(body as never);
            },
            onSuccess: () => {
                void queryClient.invalidateQueries({
                    queryKey: ["products", "pending"],
                });
                void queryClient.invalidateQueries({ queryKey: ["cafes"] });
            },
        }),
    );
};

export const useReviewQueue = () => {
    const client = useElysia().cafes;
    return useQuery({
        ...(client["review-queue"].get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["cafes", "review-queue"],
        select: unwrapResponse,
    });
};

export const usePendingProducts = () => {
    const client = useElysia().cafes;
    return useQuery({
        ...(client.products.pending.get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["products", "pending"],
        select: unwrapResponse,
    });
};
