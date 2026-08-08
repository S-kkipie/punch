"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
    const confirmPurchase = useConfirmPurchase();
    const [transactionId, setTransactionId] = useState<string>();
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
        amountCentimos: number;
        expiresAt: string;
    };
    const expired = new Date(proof.expiresAt) < new Date();
    const confirm = () => {
        confirmPurchase.mutate(
            { proofId: proof.id },
            {
                onSuccess: (result) =>
                    setTransactionId(
                        (result as { response?: { transactionId?: string } })
                            .response?.transactionId,
                    ),
            },
        );
    };
    const transaction = statusQuery.data as
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
            {transaction ? (
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
