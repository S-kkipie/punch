"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCafe, useCafeProducts } from "@/core/cafe/client/hooks";
import type { Product } from "@/core/cafe/domain/types";
import {
    useConfirmPurchase,
    usePurchaseProof,
    useTransactionStatus,
} from "@/core/consumption/client/hooks";
import { TransactionStatus } from "@/core/consumption/client/ui/transaction-status";
import { Button } from "@/frontend/components/ui/button";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function PurchaseConfirmPage() {
    const { proofId } = useParams<{ proofId: string }>();
    const router = useRouter();
    const proofQuery = usePurchaseProof(proofId);
    const proofCafeId =
        (proofQuery.data as { cafeId?: string } | undefined)?.cafeId ?? "";
    const cafeQuery = useCafe(proofCafeId);
    const productsQuery = useCafeProducts(proofCafeId);
    const confirmPurchase = useConfirmPurchase();
    const [transactionId, setTransactionId] = useState<string>();
    const [localStatus, setLocalStatus] = useState<{
        status: "pending" | "confirmed" | "rejected" | "failed";
        rejectionReason?: string;
    }>();
    const statusQuery = useTransactionStatus(transactionId);
    const [isOnline, setIsOnline] = useState(true);

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

    const proof = proofQuery.data as {
        id: string;
        cafeId: string;
        productId: string;
        amountCentimos: number;
        expiresAt: string;
    };
    const cafeName = (cafeQuery.data as { name?: string } | undefined)?.name;
    const productName = ((productsQuery.data ?? []) as Product[]).find(
        (product) => product.id === proof.productId,
    )?.name;
    const expired = new Date(proof.expiresAt) < new Date();
    const confirm = () => {
        confirmPurchase.mutate(
            { proofId: proof.id },
            {
                onSuccess: (result) => {
                    const response = (
                        result as {
                            response?: {
                                transactionId?: string;
                                status?:
                                    | "pending"
                                    | "confirmed"
                                    | "rejected"
                                    | "failed";
                                rejectionReason?: string;
                            };
                        }
                    ).response;
                    if (response?.transactionId) {
                        setTransactionId(response.transactionId);
                        setLocalStatus({
                            status: response.status ?? "pending",
                            rejectionReason: response.rejectionReason,
                        });
                    }
                },
            },
        );
    };
    const transaction = (statusQuery.data ?? localStatus) as
        | {
              status: "pending" | "confirmed" | "rejected" | "failed";
              rejectionReason?: string;
          }
        | undefined;

    return (
        <div className="mx-auto grid w-full max-w-md gap-5">
            <section className="grid gap-2">
                <span className="consumer-eyebrow">Último paso</span>
                <h1 className="consumer-title text-4xl font-bold">
                    Confirma tu compra
                </h1>
            </section>
            <div className="consumer-panel grid gap-2 p-5">
                <p className="font-semibold">
                    {cafeName ?? "Café"}
                    {productName ? ` · ${productName}` : ""}
                </p>
                <p className="font-semibold text-2xl">
                    S/ {(proof.amountCentimos / 100).toFixed(2)}
                </p>
                <p className="text-[var(--color-ink-2)] text-sm">
                    Disponible hasta{" "}
                    {new Date(proof.expiresAt).toLocaleTimeString("es-PE")}.
                </p>
            </div>
            {expired && !transactionId && (
                <p className="text-destructive text-sm">
                    Este código venció. Pide al barista uno nuevo.
                </p>
            )}
            {!isOnline && (
                <p className="text-amber-700 text-sm">
                    Sin conexión. Reconéctate para confirmar la compra.
                </p>
            )}
            {statusQuery.isError ? (
                <div className="grid gap-3 text-destructive text-sm">
                    <p>No pudimos actualizar el estado de tu compra.</p>
                    <Button
                        variant="outline"
                        onClick={() => statusQuery.refetch()}
                    >
                        Reintentar estado
                    </Button>
                </div>
            ) : transaction ? (
                <TransactionStatus
                    status={transaction.status}
                    rejectionReason={transaction.rejectionReason}
                    onRetry={confirm}
                />
            ) : (
                <Button
                    size="lg"
                    className="min-h-12 w-full"
                    disabled={expired || !isOnline || confirmPurchase.isPending}
                    onClick={confirm}
                >
                    {confirmPurchase.isPending
                        ? "Confirmando…"
                        : "Confirmar compra"}
                </Button>
            )}
            {transaction?.status === "confirmed" && (
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
