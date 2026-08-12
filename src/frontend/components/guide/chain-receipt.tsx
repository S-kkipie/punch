"use client";

import { useEffect, useState } from "react";

import { explorerTxUrl } from "@/config/explorer";
import { TxHashLink } from "@/frontend/components/tx-hash-link";

export type ChainReceiptState = "queued" | "submitted" | "confirmed" | "failed";

/** Etapas reales de una escritura: firmar, enviar, confirmar. */
export const chainStages = [
    { key: "signed", title: "Firmada", detail: "Con tu firma y la del café" },
    {
        key: "sent",
        title: "Enviada a la cadena",
        detail: "Ya tiene hash de transacción",
    },
    {
        key: "mined",
        title: "Confirmada en un bloque",
        detail: "Incluida en un bloque",
    },
] as const;

/** Cuántas etapas están hechas para cada estado. */
export function stagesDone(state: ChainReceiptState): number {
    if (state === "confirmed") return 3;
    if (state === "submitted") return 2;
    return 1;
}

/** Segundos de espera a partir de los cuales avisamos que se está tardando. */
export const STALL_SECONDS = 25;

const copy: Record<ChainReceiptState, { label: string; hint: string }> = {
    queued: {
        label: "Preparando la operación",
        hint: "Ya está firmada y en cola. Falta enviarla a la cadena: cuando salga aparece su hash aquí mismo.",
    },
    submitted: {
        label: "Confirmando en la cadena",
        hint: "Enviada. Ahora espera a que un bloque la incluya — suele tardar unos segundos.",
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

/** Segundos transcurridos desde que la espera empezó a mostrarse. */
function useElapsedSeconds(active: boolean): number {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!active) {
            setElapsed(0);
            return;
        }
        const started = Date.now();
        const timer = setInterval(() => {
            setElapsed(Math.floor((Date.now() - started) / 1000));
        }, 1000);
        return () => clearInterval(timer);
    }, [active]);

    return elapsed;
}

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
    const waiting = state === "queued" || state === "submitted";
    const elapsed = useElapsedSeconds(waiting);
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
            {state === "failed" ? null : (
                <ol className="chain-receipt__track">
                    {chainStages.map((stage, index) => {
                        const done = index < stagesDone(state);
                        const current = index === stagesDone(state) - 1;
                        return (
                            <li
                                key={stage.key}
                                className={`chain-receipt__stage${
                                    done ? " chain-receipt__stage--done" : ""
                                }${
                                    current && waiting
                                        ? " chain-receipt__stage--current"
                                        : ""
                                }`}
                            >
                                <span
                                    className="chain-receipt__mark"
                                    aria-hidden="true"
                                >
                                    {done ? "✓" : index + 1}
                                </span>
                                <span>
                                    <strong>{stage.title}</strong>
                                    <span className="chain-receipt__stage-detail">
                                        {stage.detail}
                                    </span>
                                </span>
                            </li>
                        );
                    })}
                </ol>
            )}
            <p className="chain-receipt__hint">
                {state === "failed" && failureReason ? failureReason : hint}
            </p>
            {waiting ? (
                <p className="chain-receipt__wait">
                    Esperando · {elapsed}s
                    {elapsed >= STALL_SECONDS
                        ? " · está tardando más de lo normal, la operación sigue en cola y no se perdió"
                        : ""}
                </p>
            ) : null}
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
