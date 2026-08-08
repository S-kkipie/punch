"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useElysia } from "@/frontend/lib/eden";

const unwrap = (result: unknown) => (result as { response: unknown }).response;
const onError = (error: unknown) =>
    toast.error(
        error instanceof Error ? error.message : "Ocurrió un error inesperado",
    );
const withError = <T extends object>(options: T) =>
    ({ ...options, onError }) as T;

export const useCreatePurchaseProof = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withError({
            ...client({ cafeId })["purchase-proofs"].post.mutationOptions(),
            onSuccess: () =>
                queryClient.invalidateQueries({
                    queryKey: ["consumption", "proofs"],
                }),
        }),
    );
};
export const usePurchaseProof = (proofId: string) => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client["purchase-proofs"]({
            proofId,
        }).get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["consumption", "proofs", proofId],
        select: unwrap,
        refetchInterval: 3000,
    });
};
export const useConfirmPurchase = () => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withError({
            ...client.purchases.confirm.post.mutationOptions(),
            onSuccess: () => {
                void queryClient.invalidateQueries({
                    queryKey: ["punch", "dashboard"],
                });
                void queryClient.invalidateQueries({
                    queryKey: ["consumption", "history"],
                });
            },
        }),
    );
};
export const useTransactionStatus = (transactionId: string | undefined) => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client
            .transactions({ transactionId: transactionId ?? "" })
            .get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["consumption", "transactions", transactionId],
        select: unwrap,
        enabled: Boolean(transactionId),
        refetchInterval: (query) =>
            query.state.data &&
            (query.state.data as { status: string }).status === "pending"
                ? 2000
                : false,
    });
};
export const useRequestPunchRedemption = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withError({
            ...client({ cafeId })["punch-redemptions"].post.mutationOptions(),
            onSuccess: () =>
                queryClient.invalidateQueries({
                    queryKey: ["punch", "dashboard"],
                }),
        }),
    );
};
export const useDecidePunchRedemption = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withError({
            mutationFn: async (variables: {
                requestId: string;
                [key: string]: unknown;
            }) => {
                const { requestId, ...body } = variables;
                return (
                    client({ cafeId })
                        ["punch-redemptions"]({ requestId })
                        .decide.post.mutationOptions() as unknown as {
                        mutationFn: (body: never) => unknown;
                    }
                ).mutationFn(body as never);
            },
            onSuccess: () =>
                queryClient.invalidateQueries({
                    queryKey: ["consumption", "redemption-inbox", cafeId],
                }),
        }),
    );
};
export const useRequestVoucherRedemption = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withError({
            ...client({ cafeId })["voucher-redemptions"].post.mutationOptions(),
            onSuccess: () =>
                queryClient.invalidateQueries({
                    queryKey: ["punch", "vouchers"],
                }),
        }),
    );
};
export const useDecideVoucherRedemption = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withError({
            mutationFn: async (variables: {
                requestId: string;
                [key: string]: unknown;
            }) => {
                const { requestId, ...body } = variables;
                return (
                    client({ cafeId })
                        ["voucher-redemptions"]({ requestId })
                        .decide.post.mutationOptions() as unknown as {
                        mutationFn: (body: never) => unknown;
                    }
                ).mutationFn(body as never);
            },
            onSuccess: () =>
                queryClient.invalidateQueries({
                    queryKey: ["consumption", "redemption-inbox", cafeId],
                }),
        }),
    );
};
export const useCafeRedemptionInbox = (cafeId: string) => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client({ cafeId })[
            "redemption-inbox"
        ].get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["consumption", "redemption-inbox", cafeId],
        select: unwrap,
        refetchInterval: 5000,
    });
};
