"use client";

import { explorerTxUrl } from "@/config/explorer";
import { TxHashLink } from "@/frontend/components/tx-hash-link";

export type ChainReceiptState = "queued" | "submitted" | "confirmed" | "failed";

const copy: Record<ChainReceiptState, { label: string; hint: string }> = {
    queued: {
        label: "Preparando la operación",
        hint: "Se está firmando y encolando.",
    },
    submitted: {
        label: "Confirmando en la cadena",
        hint: "Ya está enviada. Suele tardar unos segundos.",
    },
    confirmed: {
        label: "Confirmado en Arbitrum",
        hint: "Queda escrito. Nadie puede borrarlo, ni nosotros.",
    },
    failed: {
        label: "No se pudo escribir en la cadena",
        hint: "Nada se cobró ni se descontó.",
    },
};

/**
 * Muestra el ciclo de vida completo de una escritura on-chain en la pantalla
 * donde el usuario la disparó. La espera se ve como progreso con su hash, no
 * como un cuelgue: en cuanto la transacción se envía, el enlace al explorador
 * ya funciona aunque todavía no esté confirmada.
 */
export function ChainReceipt({
    state,
    txHash,
    blockNumber,
    failureReason,
    onRetry,
}: {
    state: ChainReceiptState;
    txHash?: string | null;
    blockNumber?: number | null;
    failureReason?: string | null;
    onRetry?: () => void;
}) {
    const { label: defaultLabel, hint: defaultHint } = copy[state];
    const hasPublicExplorer = txHash ? explorerTxUrl(txHash) !== null : false;
    const label =
        state === "confirmed" && !hasPublicExplorer
            ? "Confirmado en la cadena local"
            : defaultLabel;
    const hint =
        state === "confirmed" && !hasPublicExplorer
            ? "Queda escrito en la cadena local de desarrollo."
            : defaultHint;
    return (
        <div
            className={`chain-receipt chain-receipt--${state}`}
            role={state === "failed" ? "alert" : "status"}
        >
            <div className="chain-receipt__head">
                <span className="chain-receipt__label">{label}</span>
                {txHash ? <TxHashLink txHash={txHash} /> : null}
            </div>
            <p className="chain-receipt__hint">
                {state === "failed" && failureReason ? failureReason : hint}
            </p>
            {state === "confirmed" && blockNumber ? (
                <p className="chain-receipt__block">Bloque {blockNumber}</p>
            ) : null}
            {state === "failed" && onRetry ? (
                <button
                    className="guide-btn guide-btn--ghost"
                    type="button"
                    onClick={onRetry}
                >
                    Reintentar
                </button>
            ) : null}
        </div>
    );
}
