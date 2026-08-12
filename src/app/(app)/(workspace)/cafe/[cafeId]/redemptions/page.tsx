"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

import {
    useCafeRedemptionInbox,
    useDecidePunchRedemption,
    useDecideVoucherRedemption,
    useTransactionStatus,
} from "@/core/consumption/client/hooks";
import type { ConsumerTransactionStatus } from "@/core/consumption/domain/types";
import {
    ChainReceipt,
    type ChainReceiptState,
} from "@/frontend/components/guide/chain-receipt";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { JourneyCard } from "@/frontend/components/guide/journey-card";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Stat } from "@/frontend/components/guide/stat";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
import { Spinner } from "@/frontend/components/ui/spinner";

type Request = {
    id: string;
    kind: "punch_reward" | "voucher";
    status: string;
    rejectionReason?: string | null;
    failureReason?: string | null;
    transactionId?: string | null;
    transactionStatus?: ConsumerTransactionStatus | null;
    transactionFailureReason?: string | null;
    createdAt?: string | null;
    productName?: string | null;
    consumerName?: string | null;
    reimbursementAmount?: number | string | null;
};

type Settlement = {
    requestId: string;
    kind: Request["kind"];
    status: string;
    transactionId?: string;
    rejectionReason?: string | null;
    failureReason?: string | null;
};

type TransactionSnapshot = {
    status?: string;
    txHash?: string | null;
    blockNumber?: number | null;
    rejectionReason?: string | null;
    failureReason?: string | null;
};

const DEFAULT_REFUND = "S/2.80";

function formatAmount(value: Request["reimbursementAmount"]): string {
    if (value === null || value === undefined) return DEFAULT_REFUND;

    if (typeof value === "number") {
        const amount = value > 100 ? value / 100 : value;
        return `S/${amount.toFixed(2)}`;
    }

    const trimmed = value.trim();
    if (!trimmed) return DEFAULT_REFUND;
    return trimmed.startsWith("S/") ? trimmed : `S/${trimmed}`;
}

function relativeAgeLabel(createdAt: string | null | undefined): string {
    if (!createdAt) return "hace unos segundos";

    const timestamp = new Date(createdAt).getTime();
    if (Number.isNaN(timestamp)) return "hace unos segundos";

    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return "hace 40 segundos";

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `hace ${minutes} minuto${minutes === 1 ? "" : "s"}`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} hora${hours === 1 ? "" : "s"}`;

    const days = Math.floor(hours / 24);
    return `hace ${days} día${days === 1 ? "" : "s"}`;
}

function toChainReceiptState(
    status: string | undefined,
    hasTxHash: string | null | undefined,
): ChainReceiptState | null {
    if (!status) return null;

    if (status === "confirmed") return "confirmed";
    if (status === "failed" || status === "rejected") return "failed";
    if (status === "submitted") return hasTxHash ? "submitted" : "queued";
    if (
        status === "pending" ||
        status === "queued" ||
        status === "approved" ||
        status === "accepted"
    )
        return "queued";

    return null;
}

function toSettlement(request: Request): Settlement | undefined {
    if (request.status === "pending") {
        if (!request.transactionId && !request.transactionStatus)
            return undefined;
    }

    return {
        requestId: request.id,
        kind: request.kind,
        status: request.status,
        transactionId: request.transactionId ?? undefined,
        rejectionReason: request.rejectionReason,
        failureReason: request.transactionFailureReason,
    };
}

function FulfillmentItem({
    settlement,
    request,
    onRetry,
}: {
    request: Request;
    settlement?: Settlement;
    onRetry: () => void;
}) {
    const { cafeId } = useParams<{ cafeId: string }>();
    const transactionQuery = useTransactionStatus(
        settlement?.transactionId,
        cafeId,
    );

    if (!settlement) return null;

    const txSnapshot = (transactionQuery.data ?? undefined) as
        | TransactionSnapshot
        | undefined;

    if (settlement.transactionId && transactionQuery.isError) {
        return (
            <div className="grid gap-2 text-sm" role="alert">
                <p className="text-destructive">
                    No se pudo consultar el estado del canje.
                </p>
                <Button
                    variant="outline"
                    onClick={() => void transactionQuery.refetch()}
                >
                    Reintentar
                </Button>
            </div>
        );
    }

    const status = (txSnapshot?.status ?? settlement.status) as
        | string
        | undefined;
    const txHash = txSnapshot?.txHash;
    const blockNumber = txSnapshot?.blockNumber;
    const failureReason =
        txSnapshot?.rejectionReason ??
        txSnapshot?.failureReason ??
        settlement.failureReason ??
        settlement.rejectionReason ??
        request.transactionFailureReason ??
        request.failureReason;

    const state = toChainReceiptState(status, txHash);
    if (!state) return null;

    return (
        <ChainReceipt
            state={state}
            txHash={txHash ?? undefined}
            blockNumber={blockNumber}
            failureReason={failureReason ?? undefined}
            onRetry={state === "failed" ? onRetry : undefined}
        />
    );
}

export default function CafeRedemptionsPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const inboxQuery = useCafeRedemptionInbox(cafeId);
    const decidePunch = useDecidePunchRedemption(cafeId);
    const decideVoucher = useDecideVoucherRedemption(cafeId);
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const [decisions, setDecisions] = useState<Record<string, Settlement>>({});
    const [message, setMessage] = useState("");
    const [openRejection, setOpenRejection] = useState<Record<string, boolean>>(
        {},
    );

    if (inboxQuery.isPending)
        return (
            <div
                className="flex justify-center p-12"
                role="status"
                aria-label="Cargando solicitudes"
            >
                <Spinner />
            </div>
        );

    if (inboxQuery.isError)
        return (
            <p className="p-6 text-destructive">
                No se pudo cargar la bandeja de canjes.
            </p>
        );

    const requests = (inboxQuery.data ?? []) as Request[];
    const visibleRequests: Request[] = [
        ...requests,
        ...Object.values(decisions)
            .filter(
                (settlement) =>
                    !requests.some(
                        (request) => request.id === settlement.requestId,
                    ),
            )
            .map(
                (settlement) =>
                    ({
                        id: settlement.requestId,
                        kind: settlement.kind,
                        status: settlement.status,
                    }) as Request,
            ),
    ];

    const pendingCount = visibleRequests.filter(
        (request) => request.status === "pending",
    ).length;
    const pendingMutation = decidePunch.isPending || decideVoucher.isPending;

    const applyDecision = (
        request: Request,
        decision: "approved" | "rejected",
    ) => {
        const mutation =
            request.kind === "punch_reward" ? decidePunch : decideVoucher;
        mutation.mutate(
            {
                requestId: request.id,
                decision,
                rejectionReason:
                    decision === "rejected"
                        ? reasons[request.id]?.trim()
                        : undefined,
            },
            {
                onSuccess: (result) => {
                    const response = (
                        result as { response?: Partial<Settlement> }
                    ).response;

                    setDecisions((current) => ({
                        ...current,
                        [request.id]: {
                            requestId: request.id,
                            kind: request.kind,
                            status:
                                response?.status ??
                                (decision === "approved"
                                    ? "approved"
                                    : "rejected"),
                            transactionId: response?.transactionId,
                            rejectionReason:
                                response?.rejectionReason ??
                                reasons[request.id],
                            failureReason: response?.failureReason,
                        },
                    }));
                    setOpenRejection((current) => ({
                        ...current,
                        [request.id]: false,
                    }));
                    setMessage("Solicitud actualizada.");
                },
                onError: () => {
                    setMessage("No se pudo actualizar la solicitud.");
                },
            },
        );
    };

    return (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            <PageIntro
                eyebrow={`${pendingCount} esperando`}
                title="Bandeja de canjes"
                explain="El cliente ya gastó sus 12 sellos. Al entregar, confirmas el canje y la red te reembolsa desde el fondo común."
            />

            <div className="guide-stat-row">
                <Stat
                    label="Canjes en espera"
                    value={String(pendingCount)}
                    hint="Pendientes de entrega"
                    lead
                />
            </div>

            <p className="sr-only" role="status" aria-live="polite">
                {message}
            </p>

            {visibleRequests.length === 0 ? (
                <EmptyState
                    mark="☕"
                    title="No hay canjes pendientes"
                    cause="Aún no tienes solicitudes esperando entrega."
                />
            ) : (
                visibleRequests.map((request) => {
                    const remoteSettlement = toSettlement(request);
                    const settled =
                        request.status === "pending" && !remoteSettlement
                            ? decisions[request.id]
                            : (remoteSettlement ?? decisions[request.id]);

                    const isRejected =
                        settled?.status === "rejected" ||
                        request.status === "rejected";
                    const isPendingAction =
                        request.status === "pending" && !settled;
                    const isRejectOpen = Boolean(openRejection[request.id]);
                    const reasonText = reasons[request.id] ?? "";
                    const product =
                        request.productName ??
                        (request.kind === "punch_reward"
                            ? "Cappuccino clásico"
                            : "Voucher");
                    const consumer = request.consumerName ?? "Consumidor Demo";
                    const ageLabel = relativeAgeLabel(request.createdAt);
                    const amount = formatAmount(request.reimbursementAmount);
                    const refundLine = `${consumer} · ${ageLabel} · te reembolsan ${amount}`;

                    return (
                        <section
                            key={request.id}
                            className="consumer-panel grid gap-3 p-5"
                        >
                            <div className="flex items-center gap-2">
                                <p className="font-semibold text-base">
                                    {product}
                                </p>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {refundLine}
                            </p>

                            {isRejected ? (
                                <p
                                    className="text-sm text-muted-foreground"
                                    role="status"
                                >
                                    Rechazado:{" "}
                                    {settled?.rejectionReason ??
                                        request.rejectionReason ??
                                        "Sin motivo"}
                                </p>
                            ) : null}

                            {isPendingAction ? (
                                isRejectOpen ? (
                                    <>
                                        <Input
                                            aria-label="Motivo del rechazo"
                                            placeholder="Motivo si rechazas"
                                            value={reasonText}
                                            onChange={(event) =>
                                                setReasons((current) => ({
                                                    ...current,
                                                    [request.id]:
                                                        event.target.value,
                                                }))
                                            }
                                        />
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                className="min-h-11"
                                                disabled={
                                                    !reasonText.trim() ||
                                                    pendingMutation
                                                }
                                                onClick={() =>
                                                    applyDecision(
                                                        request,
                                                        "rejected",
                                                    )
                                                }
                                            >
                                                Confirmar rechazo
                                            </Button>
                                            <Button
                                                className="min-h-11"
                                                variant="outline"
                                                disabled={pendingMutation}
                                                onClick={() =>
                                                    setOpenRejection(
                                                        (current) => ({
                                                            ...current,
                                                            [request.id]: false,
                                                        }),
                                                    )
                                                }
                                            >
                                                Cancelar
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            className="min-h-11"
                                            disabled={pendingMutation}
                                            onClick={() =>
                                                applyDecision(
                                                    request,
                                                    "approved",
                                                )
                                            }
                                        >
                                            Entregar
                                        </Button>
                                        <Button
                                            className="min-h-11"
                                            variant="outline"
                                            disabled={pendingMutation}
                                            onClick={() =>
                                                setOpenRejection((current) => ({
                                                    ...current,
                                                    [request.id]: true,
                                                }))
                                            }
                                        >
                                            Rechazar
                                        </Button>
                                    </div>
                                )
                            ) : null}

                            {!isRejected ? (
                                <FulfillmentItem
                                    request={request}
                                    settlement={settled}
                                    onRetry={() =>
                                        applyDecision(request, "approved")
                                    }
                                />
                            ) : null}
                        </section>
                    );
                })
            )}

            <JourneyCard currentRole="cafeteria" />
        </div>
    );
}
