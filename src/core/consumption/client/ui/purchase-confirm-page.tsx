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
import { useDashboard } from "@/core/punch/client/hooks";
import type { PurchaseOrderStatus } from "@/core/purchase/domain/types";
import {
    ChainReceipt,
    type ChainReceiptState,
} from "@/frontend/components/guide/chain-receipt";
import { PageIntro } from "@/frontend/components/guide/page-intro";
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

function receiptStateFromOrder(
    status: PurchaseOrderStatus | undefined,
    txHash: string | null | undefined,
): ChainReceiptState | null {
    if (!status) return null;
    if (status === "queued") return "queued";
    if (status === "submitted") return txHash ? "submitted" : "queued";
    if (status === "confirmed") return "confirmed";
    if (status === "failed") return "failed";
    if (status === "user_confirmed" || status === "cafe_confirmed") {
        return txHash ? "submitted" : "queued";
    }
    return null;
}

export function PurchaseConfirmPage() {
    const { proofId } = useParams<{ proofId: string }>();
    const router = useRouter();
    const proofQuery = usePurchaseProof(proofId);
    const confirmPurchase = useConfirmPurchase();
    const dashboard = useDashboard();
    const [orderId, setOrderId] = useState<string>();
    const [localOrder, setLocalOrder] = useState<PurchaseOrder>();
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const submissionStarted = useRef(false);
    const [isOnline, setIsOnline] = useState(true);
    const orderQuery = usePurchaseOrder(orderId);

    useEffect(() => {
        const linkedOrderId = (proofQuery.data as PurchaseQuote | undefined)
            ?.purchaseOrderId;
        if (linkedOrderId) {
            setOrderId(linkedOrderId);
        } else {
            setOrderId(undefined);
            setLocalOrder(undefined);
            setHasSubmitted(false);
            submissionStarted.current = false;
        }
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
    const dashboardBalance = (
        dashboard.data as { balance: number | null } | undefined
    )?.balance;
    const projectedBalance =
        dashboardBalance === null || dashboardBalance === undefined
            ? null
            : Math.min(dashboardBalance + 1, 12);
    const unlockedReward = projectedBalance !== null && projectedBalance >= 12;
    const isPreConfirm =
        order?.status !== "confirmed" &&
        order?.status !== "failed" &&
        order?.status !== "queued" &&
        order?.status !== "submitted" &&
        order?.status !== "user_confirmed" &&
        order?.status !== "cafe_confirmed";

    const expired = new Date(proof.expiresAt) < new Date();
    const status: UiPurchaseState = order
        ? toUiPurchaseState({
              quoteStatus: proof.status,
              orderStatus: order.status,
          })
        : expired
          ? "expired"
          : toUiPurchaseState({ quoteStatus: proof.status });
    const receiptState = order
        ? receiptStateFromOrder(order.status, order.txHash)
        : null;

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
                onError: () => {
                    setHasSubmitted(false);
                    submissionStarted.current = false;
                },
            },
        );
    };

    return (
        <div className="mx-auto grid w-full max-w-md gap-5">
            <PageIntro eyebrow="Casi listo" title="¿Confirmas esta compra?" />
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
                    Ganas +1 sello
                </p>
                {projectedBalance !== null ? (
                    <p className="font-semibold text-sm">
                        Al confirmar quedarás en {projectedBalance}/12
                        {unlockedReward ? " · Recompensa disponible" : ""}
                    </p>
                ) : null}
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
            ) : receiptState ? (
                <ChainReceipt
                    state={receiptState}
                    txHash={order?.txHash}
                    failureReason={order?.failureReason ?? proof.failureReason}
                    onRetry={undefined}
                />
            ) : status !== "issued" ? (
                <TransactionStatus
                    status={status}
                    rejectionReason={
                        order?.failureReason ?? proof.failureReason ?? undefined
                    }
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
                        : "Confirmar y sellar"}
                </Button>
            )}
            {isPreConfirm && status === "issued" ? (
                <p className="text-sm text-center">
                    Se escribe en Arbitrum · verificable después
                </p>
            ) : null}
            {status === "confirmed" && unlockedReward ? (
                <section className="consumer-panel grid gap-2 p-5 text-center">
                    <span className="consumer-eyebrow">
                        Recompensa disponible
                    </span>
                    <h2 className="consumer-title text-2xl font-bold">
                        Sello 12 de 12
                    </h2>
                    <p className="text-sm">
                        Tienes un café gratis para canjear en cualquiera de las
                        cafeterías.
                    </p>
                </section>
            ) : null}
            {status === "confirmed" ? (
                <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => router.push("/home")}
                >
                    Volver a Inicio
                </Button>
            ) : null}
        </div>
    );
}

export default PurchaseConfirmPage;
