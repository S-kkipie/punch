"use client";

import { useEffect, useState } from "react";
import { hasPublicExplorer } from "@/config/explorer";
import { useHistory } from "@/core/consumption/client/hooks";
import { authClient } from "@/frontend/auth/auth";
import {
    readPunchSnapshot,
    writePunchSnapshot,
} from "@/frontend/components/consumer/offline-snapshot";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { ErrorState } from "@/frontend/components/guide/error-state";
import { LoadingState } from "@/frontend/components/guide/loading-state";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { StateStrip } from "@/frontend/components/guide/state-strip";
import { TxHashLink } from "@/frontend/components/tx-hash-link";

const chainWaitingLabel = "Esperando confirmación en la cadena…";
const publicHistoryExplain =
    "Las operaciones confirmadas quedan escritas en la cadena y puedes abrir cada una para verificarla. Una vez escritas, ni la cafetería ni PUNCH pueden cambiarlas.";
const localHistoryExplain =
    "Las operaciones confirmadas quedan escritas en la cadena local de desarrollo.";
const emptyHistoryCause =
    "Escanea el código que te dé el barista en tu próxima compra y aparecerá aquí.";
const emptyHistoryAction = { label: "Descubrir cafeterías", href: "/discover" };
const errorHistoryDetail =
    "Es un problema para mostrarte el historial, no con tus operaciones. Vuelve a intentarlo.";
const loadingHistoryLabel = "Cargando tu historial";

function ChainReceipt({ entry }: { entry: HistoryEntry }) {
    if (entry.transactionHash)
        return <TxHashLink txHash={entry.transactionHash} />;
    if (entry.status === "pending") {
        return (
            <span className="tx-link tx-link--plain">{chainWaitingLabel}</span>
        );
    }
    return null;
}

function HistoryListEntry({ entry }: { entry: HistoryEntry }) {
    return (
        <div
            className="consumer-panel flex items-center justify-between gap-4 p-5"
            key={entry.id}
        >
            <div>
                <p className="font-semibold">
                    {labels[entry.operation] ?? "Actividad"}
                </p>
                <p className="text-[var(--color-ink-2)] text-sm">
                    {provenance(entry)}
                </p>
                <p className="text-[var(--color-ink-2)] text-sm">
                    {new Date(entry.createdAt).toLocaleString("es-PE")}
                </p>
                <ChainReceipt entry={entry} />
                {entry.rejectionReason && (
                    <p className="text-sm">{entry.rejectionReason}</p>
                )}
            </div>
            <span className="text-sm">
                {statuses[entry.status] ?? entry.status}
            </span>
        </div>
    );
}

function HistoryEmptyState() {
    return (
        <EmptyState
            mark="☕"
            title="Todavía no tienes actividad"
            cause={emptyHistoryCause}
            action={emptyHistoryAction}
        />
    );
}

function HistoryIntro() {
    return (
        <PageIntro
            eyebrow="Tu recorrido"
            title="Historial"
            explain={
                hasPublicExplorer() ? publicHistoryExplain : localHistoryExplain
            }
        />
    );
}

function HistoryErrorState({ onRetry }: { onRetry: () => void }) {
    return (
        <ErrorState
            title="No pudimos traer tu historial"
            detail={errorHistoryDetail}
            onRetry={onRetry}
        />
    );
}

function HistoryLoadingState() {
    return <LoadingState label={loadingHistoryLabel} lines={4} />;
}

function SavedHistoryStrip() {
    return (
        <StateStrip tone="saved">
            Datos guardados · Conéctate para actualizar
        </StateStrip>
    );
}

function HistoryEntries({ entries }: { entries: HistoryEntry[] }) {
    return entries.length === 0 ? (
        <HistoryEmptyState />
    ) : (
        entries.map((entry) => (
            <HistoryListEntry entry={entry} key={entry.id} />
        ))
    );
}

function HistoryContent({
    entries,
    savedEntries,
    hasQueryData,
}: {
    entries: HistoryEntry[];
    savedEntries: HistoryEntry[] | null;
    hasQueryData: boolean;
}) {
    return (
        <div className="mx-auto grid w-full max-w-2xl gap-5">
            {savedEntries && !hasQueryData ? <SavedHistoryStrip /> : null}
            <HistoryIntro />
            <HistoryEntries entries={entries} />
        </div>
    );
}

const labels: Record<string, string> = {
    emission: "PUNCH ganado",
    punch_redemption: "Canje de PUNCH",
    voucher_redemption: "Voucher usado",
};
type HistoryEntry = {
    id: string;
    operation: string;
    cafeName?: string | null;
    productName?: string | null;
    campaignName?: string | null;
    crawlName?: string | null;
    status: string;
    rejectionReason: string | null;
    createdAt: string;
    transactionHash: string | null;
};

function provenance(entry: HistoryEntry): string | null {
    const cafe = entry.cafeName ?? "Café no disponible";
    if (entry.operation === "emission") {
        return `${cafe} · ${entry.productName ?? "Producto no disponible"}`;
    }
    if (entry.operation === "punch_redemption") {
        return `${cafe} · ${entry.productName ?? "Recompensa no disponible"}`;
    }
    const source = entry.campaignName
        ? `Campaña: ${entry.campaignName}`
        : entry.crawlName
          ? `Recorrido: ${entry.crawlName}`
          : "Voucher sin origen disponible";
    return `${cafe} · ${source}`;
}

const statuses: Record<string, string> = {
    pending: "En proceso",
    confirmed: "Listo",
    rejected: "No aprobado",
    failed: "No completado",
};

export default function HistoryPage() {
    const query = useHistory();
    const sessionQuery = authClient.useSession();
    const userId = sessionQuery.data?.user.id;
    const [savedEntries, setSavedEntries] = useState<HistoryEntry[] | null>(
        null,
    );

    useEffect(() => {
        if (!userId || typeof window === "undefined") return;
        if (query.data) {
            writePunchSnapshot(
                window.localStorage,
                userId,
                "history",
                query.data,
            );
        } else if (query.isError && navigator.onLine === false) {
            setSavedEntries(
                readPunchSnapshot<HistoryEntry[]>(
                    window.localStorage,
                    userId,
                    "history",
                ),
            );
        }
    }, [query.data, query.isError, userId]);
    if (query.isPending) return <HistoryLoadingState />;
    if (query.isError && !savedEntries)
        return <HistoryErrorState onRetry={() => query.refetch()} />;
    const entries = (query.data ?? savedEntries ?? []) as HistoryEntry[];
    return (
        <HistoryContent
            entries={entries}
            savedEntries={savedEntries}
            hasQueryData={Boolean(query.data)}
        />
    );
}
