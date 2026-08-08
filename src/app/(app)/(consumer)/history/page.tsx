"use client";

import { useEffect, useState } from "react";
import { useHistory } from "@/core/consumption/client/hooks";
import { authClient } from "@/frontend/auth/auth";
import {
    readPunchSnapshot,
    writePunchSnapshot,
} from "@/frontend/components/consumer/offline-snapshot";
import { Button } from "@/frontend/components/ui/button";
import { Spinner } from "@/frontend/components/ui/spinner";

const labels: Record<string, string> = {
    emission: "PUNCH ganado",
    punch_redemption: "Canje de PUNCH",
    voucher_redemption: "Voucher usado",
};
type HistoryEntry = {
    id: string;
    operation: string;
    status: string;
    rejectionReason: string | null;
    createdAt: string;
};

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
    if (query.isPending)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );
    if (query.isError && !savedEntries)
        return (
            <div className="consumer-panel grid gap-3 p-6">
                <p>
                    No se pudo cargar tu historial. Conéctate para actualizarlo.
                </p>
                <Button onClick={() => query.refetch()}>Reintentar</Button>
            </div>
        );
    const entries = (query.data ?? savedEntries ?? []) as Array<{
        id: string;
        operation: string;
        status: string;
        rejectionReason: string | null;
        createdAt: string;
    }>;
    return (
        <div className="mx-auto grid w-full max-w-2xl gap-5">
            {savedEntries && !query.data && (
                <p
                    className="rounded-md bg-[var(--color-surface-2)] p-3 text-sm"
                    role="status"
                >
                    Datos guardados · Conéctate para actualizar
                </p>
            )}
            <section className="grid gap-2">
                <span className="consumer-eyebrow">Tu recorrido</span>
                <h1 className="consumer-title text-4xl font-bold">Historial</h1>
            </section>
            {entries.length === 0 ? (
                <div className="consumer-panel p-6 text-[var(--color-ink-2)]">
                    Todavía no tienes actividad.
                </div>
            ) : (
                entries.map((entry) => (
                    <div
                        className="consumer-panel flex items-center justify-between gap-4 p-5"
                        key={entry.id}
                    >
                        <div>
                            <p className="font-semibold">
                                {labels[entry.operation] ?? "Actividad"}
                            </p>
                            <p className="text-[var(--color-ink-2)] text-sm">
                                {new Date(entry.createdAt).toLocaleString(
                                    "es-PE",
                                )}
                            </p>
                            {entry.rejectionReason && (
                                <p className="text-destructive text-sm">
                                    {entry.rejectionReason}
                                </p>
                            )}
                        </div>
                        <span className="text-sm">
                            {statuses[entry.status] ?? entry.status}
                        </span>
                    </div>
                ))
            )}
        </div>
    );
}
