"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import {
    useCafeRedemptionInbox,
    useDecidePunchRedemption,
    useDecideVoucherRedemption,
    useTransactionStatus,
} from "@/core/consumption/client/hooks";
import { TransactionStatus } from "@/core/consumption/client/ui/transaction-status";
import type { ConsumerTransactionStatus } from "@/core/consumption/domain/types";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent } from "@/frontend/components/ui/card";
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
};
type Settlement = {
    requestId: string;
    kind: Request["kind"];
    transactionId?: string;
    status: ConsumerTransactionStatus;
    rejectionReason?: string;
};
function FulfillmentItem({
    decision,
    onRetry,
}: {
    decision?: Settlement;
    onRetry: () => void;
}) {
    const { cafeId } = useParams<{ cafeId: string }>();
    const transactionQuery = useTransactionStatus(
        decision?.transactionId ?? "",
        cafeId,
    );
    const transaction = (transactionQuery.data ?? decision) as
        | Settlement
        | undefined;
    if (transactionQuery.isError) {
        return (
            <div className="grid gap-2 text-sm" role="alert">
                <p className="text-destructive">
                    No se pudo consultar el estado del canje.
                </p>
                <Button
                    variant="outline"
                    onClick={() => transactionQuery.refetch()}
                >
                    Reintentar
                </Button>
            </div>
        );
    }
    if (!transaction?.status) return null;
    return (
        <TransactionStatus
            status={transaction.status}
            rejectionReason={transaction.rejectionReason}
            onRetry={
                transaction.status === "failed" ||
                transaction.status === "rejected"
                    ? onRetry
                    : undefined
            }
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
            .map((settlement) => ({
                id: settlement.requestId,
                kind: settlement.kind,
                status: settlement.status,
            })),
    ];
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
                    decision === "rejected" ? reasons[request.id] : undefined,
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
                            status: response?.status ?? "pending",
                            transactionId: response?.transactionId,
                            rejectionReason: response?.rejectionReason,
                        },
                    }));
                    setMessage("Solicitud actualizada.");
                },
                onError: () =>
                    setMessage("No se pudo actualizar la solicitud."),
            },
        );
    };

    return (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            <h1 className="font-semibold text-2xl">Bandeja de canjes</h1>
            <p className="sr-only" role="status" aria-live="polite">
                {message}
            </p>
            {visibleRequests.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-muted-foreground">
                        No hay solicitudes pendientes.
                    </CardContent>
                </Card>
            ) : (
                visibleRequests.map((request) => {
                    const decision =
                        decisions[request.id] ??
                        (request.transactionId && request.transactionStatus
                            ? {
                                  requestId: request.id,
                                  kind: request.kind,
                                  transactionId: request.transactionId,
                                  status: request.transactionStatus,
                                  rejectionReason:
                                      request.rejectionReason ?? undefined,
                              }
                            : undefined);
                    const pending =
                        decidePunch.isPending || decideVoucher.isPending;
                    return (
                        <Card key={request.id}>
                            <CardContent className="space-y-3 p-4">
                                <p className="font-medium">
                                    {request.kind === "punch_reward"
                                        ? "Canje de PUNCH"
                                        : "Uso de voucher"}
                                </p>
                                {request.status === "confirmed" && (
                                    <p className="text-sm" role="status">
                                        Confirmado: S/3.60
                                    </p>
                                )}
                                {request.status === "failed" && (
                                    <p
                                        className="text-destructive text-sm"
                                        role="alert"
                                    >
                                        Falló:{" "}
                                        {request.failureReason ??
                                            "No se pudo completar el canje."}
                                    </p>
                                )}
                                {request.status === "rejected" && (
                                    <p
                                        className="text-muted-foreground text-sm"
                                        role="status"
                                    >
                                        Rechazado:{" "}
                                        {request.rejectionReason ??
                                            "Sin motivo indicado."}
                                    </p>
                                )}
                                {request.status === "approved" && !decision && (
                                    <p className="text-sm" role="status">
                                        Procesando on-chain
                                    </p>
                                )}
                                {!decision && request.status === "pending" && (
                                    <>
                                        <Input
                                            aria-label="Motivo del rechazo"
                                            placeholder="Motivo si rechazas"
                                            value={reasons[request.id] ?? ""}
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
                                                disabled={pending}
                                                onClick={() =>
                                                    applyDecision(
                                                        request,
                                                        "approved",
                                                    )
                                                }
                                            >
                                                Aprobar
                                            </Button>
                                            <Button
                                                className="min-h-11"
                                                variant="outline"
                                                disabled={
                                                    !reasons[
                                                        request.id
                                                    ]?.trim() || pending
                                                }
                                                onClick={() =>
                                                    applyDecision(
                                                        request,
                                                        "rejected",
                                                    )
                                                }
                                            >
                                                Rechazar
                                            </Button>
                                        </div>
                                    </>
                                )}
                                <FulfillmentItem
                                    decision={decision}
                                    onRetry={() =>
                                        applyDecision(request, "approved")
                                    }
                                />
                            </CardContent>
                        </Card>
                    );
                })
            )}
        </div>
    );
}
