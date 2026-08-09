"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
    useConfirmPurchase,
    usePurchaseOrder,
    usePurchaseProof,
} from "@/core/consumption/client/hooks";
import {
    toUiPurchaseState,
    type UiPurchaseState,
} from "@/core/consumption/client/purchase-status";
import { TransactionStatus } from "@/core/consumption/client/ui/transaction-status";
import type { PurchaseOrderStatus } from "@/core/purchase/domain/types";
import { Button } from "@/frontend/components/ui/button";
import { Spinner } from "@/frontend/components/ui/spinner";

type PurchaseOrder = {
    id: string;
    status: PurchaseOrderStatus;
    failureReason?: string | null;
    txHash?: string | null;
};

type PurchaseQuote = {
    id: string;
    cafeId: string;
    productId: string;
    amountCentimos: number;
    expiresAt: string;
    status: "issued" | "submitted" | "confirmed" | "failed" | "expired";
    maskedYapeRef: string;
    purchaseOrderId: string | null;
    failureReason: string | null;
};

export default function PurchaseConfirmPage() {
    const { proofId } = useParams<{ proofId: string }>();
    const router = useRouter();
    const proofQuery = usePurchaseProof(proofId);
    const confirmPurchase = useConfirmPurchase();
    const [orderId, setOrderId] = useState<string>();
    const [localOrder, setLocalOrder] = useState<PurchaseOrder>();
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const submissionStarted = useRef(false);
    const [isOnline, setIsOnline] = useState(true);
    const orderQuery = usePurchaseOrder(orderId);

    useEffect(() => {
        const linkedOrderId = (proofQuery.data as PurchaseQuote | undefined)
            ?.purchaseOrderId;
        if (linkedOrderId) setOrderId(linkedOrderId);
    }, [proofQuery.data]);

    useEffect(() => {
        setIsOnline(navigator.onLine);
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        window.addEventListener("online", goOnline);
        window.addEventListener("offline", goOffline);
        return () => {
            window.removeEventListener("online", goOnline);
            window.removeEventListener("offline", goOffline);
        };
    }, []);

    if (proofQuery.isPending)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );
    if (proofQuery.isError || !proofQuery.data)
        return <p className="text-destructive">No se pudo cargar la compra.</p>;

    const proof = proofQuery.data as PurchaseQuote;
    const order = (orderQuery.data ?? localOrder) as PurchaseOrder | undefined;
    const expired = new Date(proof.expiresAt) < new Date();
    const status: UiPurchaseState = order
        ? toUiPurchaseState({
              quoteStatus: proof.status,
              orderStatus: order.status,
          })
        : expired
          ? "expired"
          : toUiPurchaseState({ quoteStatus: proof.status });
    const confirm = () => {
        if (
            !isOnline ||
            !proof.id ||
            (submissionStarted.current && !order) ||
            (hasSubmitted && !order)
        )
            return;
        if (!order) submissionStarted.current = true;
        setHasSubmitted(true);
        confirmPurchase.mutate(
            { proofId: proof.id },
            {
                onSuccess: (result) => {
                    const response = (
                        result as {
                            response?: {
                                order?: PurchaseOrder;
                                quote?: PurchaseQuote;
                            };
                        }
                    ).response;
                    if (!response?.order) return;
                    setOrderId(response.order.id);
                    setLocalOrder(response.order);
                },
            },
        );
    };

    return (
        <div className="mx-auto grid w-full max-w-md gap-5">
            <section className="grid gap-2">
                <span className="consumer-eyebrow">Último paso</span>
                <h1 className="consumer-title text-4xl font-bold">
                    Confirma tu compra
                </h1>
            </section>
            <div className="consumer-panel grid gap-2 p-5">
                <p className="font-semibold">Café: {proof.cafeId}</p>
                <p className="font-semibold">Producto: {proof.productId}</p>
                <p className="font-semibold">
                    S/ {(proof.amountCentimos / 100).toFixed(2)}
                </p>
                <p className="text-[var(--color-ink-2)] text-sm">
                    Referencia Yape: {proof.maskedYapeRef}
                </p>
                <p className="text-[var(--color-ink-2)] text-sm">
                    Disponible hasta{" "}
                    {new Date(proof.expiresAt).toLocaleTimeString("es-PE")}.
                </p>
            </div>
            {!orderQuery.isError && status === "issued" && !isOnline && (
                <p className="text-amber-700 text-sm">
                    Sin conexión. Reconéctate para confirmar la compra.
                </p>
            )}
            {orderQuery.isError ? (
                <div className="grid gap-3 text-destructive text-sm">
                    <p>No pudimos actualizar el estado de tu compra.</p>
                    <Button
                        variant="outline"
                        onClick={() => orderQuery.refetch()}
                    >
                        Reintentar estado
                    </Button>
                </div>
            ) : status !== "issued" ? (
                <TransactionStatus
                    status={status}
                    rejectionReason={
                        order?.failureReason ?? proof.failureReason ?? undefined
                    }
                    onRetry={status === "failed" ? confirm : undefined}
                />
            ) : (
                <Button
                    size="lg"
                    className="min-h-12 w-full"
                    disabled={
                        expired ||
                        !isOnline ||
                        confirmPurchase.isPending ||
                        hasSubmitted
                    }
                    onClick={confirm}
                >
                    {confirmPurchase.isPending
                        ? "Confirmando…"
                        : "Confirmar compra"}
                </Button>
            )}
            {order?.txHash ? (
                <p className="text-muted-foreground text-xs">
                    Código de operación: {order.txHash.slice(0, 8)}…
                    {order.txHash.slice(-6)}
                </p>
            ) : null}
            {status === "confirmed" && (
                <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => router.push("/home")}
                >
                    Volver a Inicio
                </Button>
            )}
        </div>
    );
}
