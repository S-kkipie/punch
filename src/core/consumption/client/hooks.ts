"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PurchaseOrderStatus } from "@/core/purchase/domain/types";
import { useElysia } from "@/frontend/lib/eden";
import {
    purchaseOrderQueryKey,
    purchaseQuoteQueryKey,
} from "./purchase-status";

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
const terminalQuoteStatuses = new Set(["confirmed", "failed", "expired"]);

const quotePollingInterval = (query: { state: { data: unknown } }) => {
    const data = query.state.data as
        | { status?: string; response?: { status?: string } }
        | undefined;
    const status = data?.response?.status ?? data?.status;
    return status && terminalQuoteStatuses.has(status) ? false : 3000;
};

export const usePurchaseProof = (proofId: string) => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client["purchase-proofs"]({
            proofId,
        }).get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: purchaseQuoteQueryKey(proofId),
        select: unwrap,
        refetchInterval: quotePollingInterval,
    });
};

export const usePurchaseOrder = (orderId: string | undefined) => {
    const client = useElysia();
    return useQuery({
        ...(client
            .purchases({ id: orderId ?? "" })
            .get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: purchaseOrderQueryKey(orderId ?? ""),
        select: unwrap,
        enabled: Boolean(orderId),
        refetchInterval: (query: { state: { data: unknown } }) => {
            const data = query.state.data as
                | {
                      status?: PurchaseOrderStatus;
                      response?: { status?: PurchaseOrderStatus };
                  }
                | undefined;
            const status = data?.response?.status ?? data?.status;
            return status === "queued" || status === "submitted" ? 2000 : false;
        },
    });
};

export const useConfirmPurchase = () => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withError({
            ...client.purchases.confirm.post.mutationOptions(),
            onSuccess: (result: unknown) => {
                const response = (
                    result as {
                        response?: {
                            order?: { id: string; status: PurchaseOrderStatus };
                            quote?: { id: string };
                        };
                    }
                ).response;
                if (!response?.order || !response.quote) return;
                queryClient.setQueryData(
                    purchaseOrderQueryKey(response.order.id),
                    { response: response.order },
                );
                queryClient.setQueryData(
                    purchaseQuoteQueryKey(response.quote.id),
                    { response: response.quote },
                );
                if (
                    ["confirmed", "failed", "expired"].includes(
                        response.order.status,
                    )
                ) {
                    void queryClient.invalidateQueries({
                        queryKey: punchDashboardQueryKey,
                    });
                    void queryClient.invalidateQueries({
                        queryKey: punchVouchersQueryKey,
                    });
                    void queryClient.invalidateQueries({
                        queryKey: ["consumption", "history"],
                    });
                    void queryClient.invalidateQueries({
                        queryKey: ["punch", "campaigns"],
                    });
                    void queryClient.invalidateQueries({
                        queryKey: ["punch", "crawls"],
                    });
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
                cafeId,
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
