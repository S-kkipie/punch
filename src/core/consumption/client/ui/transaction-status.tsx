import type { ConsumerTransactionStatus } from "@/core/consumption/domain/types";

export type UiTransactionState =
    | "loading"
    | "awaiting_signature"
    | "queued"
    | "submitted"
    | "expired"
    | ConsumerTransactionStatus;

export function transactionStatusCopy(status: UiTransactionState): {
    label: string;
    hint: string;
} {
    switch (status) {
        case "loading":
            return {
                label: "Cargando",
                hint: "Estamos preparando la operación.",
            };
        case "awaiting_signature":
            return {
                label: "Esperando firma",
                hint: "Confirma para autorizar.",
            };
        case "queued":
            return {
                label: "Confirmación en cola",
                hint: "Estamos registrando tu compra.",
            };
        case "submitted":
            return {
                label: "Procesando compra",
                hint: "Estamos esperando la confirmación.",
            };
        case "expired":
            return {
                label: "Código vencido",
                hint: "Pide al barista uno nuevo.",
            };
        case "pending":
            return {
                label: "Pendiente on-chain",
                hint: "Esto puede tardar unos segundos.",
            };
        case "confirmed":
            return { label: "Confirmado", hint: "Tu PUNCH se actualizó." };
        case "failed":
            return { label: "Reintento disponible", hint: "Intenta de nuevo." };
        case "rejected":
            return {
                label: "Rechazado",
                hint: "Revisa el motivo indicado por el café.",
            };
    }
}

export function TransactionStatus({
    status,
    rejectionReason,
    onRetry,
}: {
    status: UiTransactionState;
    rejectionReason?: string;
    onRetry?: () => void;
}) {
    const copy = transactionStatusCopy(status);
    const isSuccess = status === "confirmed";
    const isError = status === "failed" || status === "rejected";

    return (
        <div
            role="status"
            aria-live="polite"
            className={`transaction-status transaction-status--${isSuccess ? "success" : isError ? "error" : "neutral"}`}
        >
            <div className="transaction-status__copy">
                <strong>{copy.label}</strong>
                <span>
                    {status === "rejected" && rejectionReason
                        ? rejectionReason
                        : copy.hint}
                </span>
            </div>
            {(status === "failed" || status === "rejected") && onRetry ? (
                <button
                    type="button"
                    className="transaction-status__action"
                    onClick={onRetry}
                >
                    Reintentar
                </button>
            ) : null}
        </div>
    );
}
