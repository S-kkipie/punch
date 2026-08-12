"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useElysia } from "@/frontend/lib/eden";

export const cafeCampaignsQueryKey = (cafeId: string) =>
    ["campaigns", "cafe", cafeId] as const;
const unwrap = (result: unknown) => (result as { response: unknown }).response;
const onError = (error: unknown) =>
    toast.error(
        error instanceof Error ? error.message : "Ocurrió un error inesperado",
    );

export const useCafeCampaigns = (cafeId: string) => {
    const client = useElysia();
    return useQuery({
        ...(client
            .cafe({ cafeId })
            .campaigns.get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: cafeCampaignsQueryKey(cafeId),
        select: unwrap,
        refetchInterval: 5000,
    });
};

export const useCreateCampaign = (cafeId: string) => {
    const client = useElysia();
    const queryClient = useQueryClient();
    const options = client.cafe({ cafeId }).campaigns.post.mutationOptions();
    return useMutation({
        mutationFn: async (variables: {
            name: string;
            voucherPayout: string;
            maxVouchers: number;
            windowStart: string;
            windowEnd: string;
        }) =>
            unwrap(
                await (
                    options.mutationFn as unknown as (body: unknown) => unknown
                )(variables),
            ),
        onError,
        onSuccess: () =>
            void queryClient.invalidateQueries({
                queryKey: cafeCampaignsQueryKey(cafeId),
            }),
    });
};

export const useFundCampaign = (cafeId: string) => {
    const client = useElysia();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (variables: {
            campaignId: string;
            amount: string;
        }) => {
            const options = client
                .cafe({ cafeId })
                .campaigns({ campaignId: variables.campaignId })
                .fund.post.mutationOptions();
            return unwrap(
                await (
                    options.mutationFn as unknown as (body: unknown) => unknown
                )({ amount: variables.amount }),
            );
        },
        onError,
        onSuccess: () =>
            void queryClient.invalidateQueries({
                queryKey: cafeCampaignsQueryKey(cafeId),
            }),
    });
};

export const usePublishCampaign = (cafeId: string) => {
    const client = useElysia();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (campaignId: string) => {
            const options = client
                .cafe({ cafeId })
                .campaigns({ campaignId })
                .publish.post.mutationOptions();
            return unwrap(
                await (
                    options.mutationFn as unknown as (
                        body: undefined,
                    ) => unknown
                )(undefined),
            );
        },
        onError,
        onSuccess: () =>
            void queryClient.invalidateQueries({
                queryKey: cafeCampaignsQueryKey(cafeId),
            }),
    });
};

export const useCancelCampaign = (cafeId: string) => {
    const client = useElysia();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (campaignId: string) => {
            const options = client
                .cafe({ cafeId })
                .campaigns({ campaignId })
                .cancel.post.mutationOptions();
            return unwrap(
                await (
                    options.mutationFn as unknown as (
                        body: undefined,
                    ) => unknown
                )(undefined),
            );
        },
        onError,
        onSuccess: () =>
            void queryClient.invalidateQueries({
                queryKey: cafeCampaignsQueryKey(cafeId),
            }),
    });
};
