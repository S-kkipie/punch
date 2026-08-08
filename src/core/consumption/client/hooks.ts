"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useElysia } from "@/frontend/lib/eden";

export const punchDashboardQueryKey = ["punch", "dashboard"] as const;
export const punchVouchersQueryKey = ["punch", "vouchers"] as const;
export const consumptionTransactionQueryKey = (
    transactionId: string | undefined,
) => ["consumption", "transactions", transactionId] as const;
export const consumptionRedemptionInboxQueryKey = (cafeId: string) =>
    ["consumption", "redemption-inbox", cafeId] as const;

const unwrap = (result: unknown) => (result as { response: unknown }).response;

export const useHistory = () => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client.history.get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["consumption", "history"],
        select: unwrap,
    });
};
const onError = (error: unknown) =>
    toast.error(
        error instanceof Error ? error.message : "Ocurrió un error inesperado",
    );
const withError = <T extends object>(options: T) =>
    ({ ...options, onError }) as T;

export const useCreatePurchaseProof = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    const options = client({ cafeId })[
        "purchase-proofs"
    ].post.mutationOptions();
    return useMutation(
        withError({
            ...options,
            mutationFn: async (
                variables: Parameters<
                    NonNullable<typeof options.mutationFn>
                >[0],
            ) => unwrap(await options.mutationFn(variables)),
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
            onSuccess: (result: unknown) => {
                void queryClient.invalidateQueries({
                    queryKey: punchDashboardQueryKey,
                });
                void queryClient.invalidateQueries({
                    queryKey: punchVouchersQueryKey,
                });
                const response = (
                    result as {
                        response?: {
                            transactionId?: string;
                            status?: string;
                            rejectionReason?: string;
                        };
                    }
                ).response;
                if (response?.transactionId && response.status) {
                    queryClient.setQueryData(
                        consumptionTransactionQueryKey(response.transactionId),
                        { response },
                    );
                }
            },
        }),
    );
};

export const transactionPollingInterval = (query: {
    state: { data: unknown };
}) => {
    const data = query.state.data as
        | { status?: string; response?: { status?: string } }
        | undefined;
    const status = data?.response?.status ?? data?.status;
    return status === "pending" ? 2000 : false;
};
export const useTransactionStatus = (
    transactionId: string | undefined,
    cafeId?: string,
) => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client
            .transactions({ transactionId: transactionId ?? "" })
            .get.queryOptions({
                query: cafeId ? { cafeId } : undefined,
            }) as unknown as Record<string, unknown>),
        queryKey: [...consumptionTransactionQueryKey(transactionId), cafeId],
        select: unwrap,
        enabled: Boolean(transactionId),
        refetchInterval: transactionPollingInterval,
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
                    queryKey: punchDashboardQueryKey,
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
            onSuccess: (result: unknown) => {
                void queryClient.invalidateQueries({
                    queryKey: punchDashboardQueryKey,
                });
                void queryClient.invalidateQueries({
                    queryKey: consumptionRedemptionInboxQueryKey(cafeId),
                });
                const transactionId = (
                    result as { response?: { transactionId?: string } }
                )?.response?.transactionId;
                if (transactionId)
                    void queryClient.invalidateQueries({
                        queryKey: consumptionTransactionQueryKey(transactionId),
                    });
            },
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
                    queryKey: punchVouchersQueryKey,
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
            onSuccess: (result: unknown) => {
                void queryClient.invalidateQueries({
                    queryKey: punchDashboardQueryKey,
                });
                void queryClient.invalidateQueries({
                    queryKey: punchVouchersQueryKey,
                });
                void queryClient.invalidateQueries({
                    queryKey: consumptionRedemptionInboxQueryKey(cafeId),
                });
                const transactionId = (
                    result as { response?: { transactionId?: string } }
                )?.response?.transactionId;
                if (transactionId)
                    void queryClient.invalidateQueries({
                        queryKey: consumptionTransactionQueryKey(transactionId),
                    });
            },
        }),
    );
};
export const useCafeRedemptionInbox = (cafeId: string) => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client({ cafeId })[
            "redemption-inbox"
        ].get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: consumptionRedemptionInboxQueryKey(cafeId),
        select: unwrap,
        refetchInterval: 5000,
    });
};
