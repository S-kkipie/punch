"use client";

import { revertMessage } from "@/core/chain/domain/revert-copy";
import {
    ChainReceipt,
    type ChainReceiptState,
} from "@/frontend/components/guide/chain-receipt";
import { TxHashLink } from "@/frontend/components/tx-hash-link";

export type CampaignChainOp = {
    kind: string;
    status: "pending" | "submitted" | "confirmed" | "failed";
    txHash: string | null;
    error: string | null;
    createdAt: string;
};

/** Nombre humano de cada escritura; el `kind` del job no se le muestra a nadie. */
const opLabels: Record<string, string> = {
    campaign_create: "Creación de la campaña",
    campaign_fund_approve: "Permiso para mover tu mPEN",
    campaign_fund: "Depósito del presupuesto",
    campaign_publish: "Publicación de la campaña",
    campaign_cancel: "Cancelación y devolución del presupuesto",
};

/** Orden real del ciclo, no el de llegada de los jobs. */
const opOrder = [
    "campaign_create",
    "campaign_fund_approve",
    "campaign_fund",
    "campaign_publish",
    "campaign_cancel",
];

export const opLabel = (kind: string) => opLabels[kind] ?? kind;

/** El job usa "pending"; el recibo llama a esa etapa "queued". */
export function receiptState(
    status: CampaignChainOp["status"],
): ChainReceiptState {
    return status === "pending" ? "queued" : status;
}

export type OpGroup = {
    kind: string;
    status: CampaignChainOp["status"];
    txHash: string | null;
    error: string | null;
    createdAt: string;
    attempts: number;
};

/**
 * Cada reintento del relayer es un job propio, así que financiar dos veces
 * llenaba la pantalla con decenas de filas iguales. Se colapsa a una fila por
 * tipo de operación: su estado vigente y cuántos intentos hubo.
 */
export function groupOps(ops: readonly CampaignChainOp[]): OpGroup[] {
    const groups = new Map<string, OpGroup>();
    for (const op of ops) {
        const current = groups.get(op.kind);
        if (!current) {
            groups.set(op.kind, { ...op, attempts: 1 });
            continue;
        }
        // `ops` llega de la más nueva a la más vieja, así que la primera de
        // cada tipo ya es la vigente. Solo una confirmada desplaza a un fallo
        // más reciente: ese intento sí terminó bien.
        const winner =
            current.status !== "confirmed" && op.status === "confirmed"
                ? op
                : current;
        groups.set(op.kind, {
            ...winner,
            attempts: current.attempts + 1,
        });
    }
    return [...groups.values()].sort((left, right) => {
        const leftIndex = opOrder.indexOf(left.kind);
        const rightIndex = opOrder.indexOf(right.kind);
        return (
            (leftIndex === -1 ? opOrder.length : leftIndex) -
            (rightIndex === -1 ? opOrder.length : rightIndex)
        );
    });
}

/**
 * La operación que merece el recibo grande: la más avanzada del ciclo que
 * todavía no terminó bien. Mirar los jobs sueltos no sirve — un reintento
 * viejo que falló sigue ahí aunque otro intento del mismo paso ya confirmó,
 * y ese fallo muerto tapaba el paso donde el dueño está realmente atascado.
 */
export function liveOp(ops: readonly CampaignChainOp[]): OpGroup | null {
    const pending = groupOps(ops).filter(
        (group) => group.status !== "confirmed",
    );
    return pending.length > 0 ? pending[pending.length - 1] : null;
}

const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
    });

const statusMark: Record<CampaignChainOp["status"], string> = {
    confirmed: "✓",
    failed: "×",
    pending: "·",
    submitted: "·",
};

/**
 * Todo lo que esta campaña escribió en la cadena, con su hash. Publicar o
 * financiar dejaba al dueño mirando una pantalla quieta sin saber si su
 * operación seguía viva: aquí ve en qué etapa va y puede abrir la transacción.
 */
export function CampaignChainTrail({
    ops,
    showProgress = true,
}: {
    ops: CampaignChainOp[];
    /**
     * Una campaña cerrada no tiene operación en curso: mostrar el recibo de un
     * intento fallido ahí sugiere que todavía falta hacer algo.
     */
    showProgress?: boolean;
}) {
    if (ops.length === 0) return null;
    const live = showProgress ? liveOp(ops) : null;
    const groups = groupOps(ops);

    return (
        <div className="chain-trail">
            {live ? (
                <>
                    <span className="chain-trail__now">
                        {opLabel(live.kind)}
                    </span>
                    <ChainReceipt
                        state={receiptState(live.status)}
                        txHash={live.txHash}
                        failureReason={revertMessage(live.error)}
                    />
                </>
            ) : null}
            <ul className="chain-trail__list">
                {groups.map((group) => (
                    <li className="chain-trail__item" key={group.kind}>
                        <span className="chain-trail__kind">
                            {statusMark[group.status]} {opLabel(group.kind)}
                            {group.attempts > 1 ? (
                                <span className="chain-trail__attempts">
                                    {" "}
                                    · {group.attempts} intentos
                                </span>
                            ) : null}
                        </span>
                        <span className="chain-trail__meta">
                            {group.txHash ? (
                                <TxHashLink txHash={group.txHash} />
                            ) : (
                                <span className="chain-trail__pending">
                                    sin hash todavía
                                </span>
                            )}
                            <span className="chain-trail__time">
                                {timeLabel(group.createdAt)}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
