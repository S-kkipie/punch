"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Dashboard } from "@/core/punch/domain/types";
import { authClient } from "@/frontend/auth/auth";
import { readPunchSnapshot } from "@/frontend/components/consumer/offline-snapshot";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { StateStrip } from "@/frontend/components/guide/state-strip";

function OfflineEmptyState() {
    return (
        <EmptyState
            mark="✈"
            title="Sin conexión"
            cause="Todavía no hay datos para mostrarte sin señal. Conéctate para descargar tu estado local."
            action={{ label: "Reintentar", href: "/home" }}
        />
    );
}

function OfflineContent({ dashboard }: { dashboard: Dashboard }) {
    const progress = dashboard.progress
        ? `${dashboard.progress.numerator} / ${dashboard.progress.denominator}`
        : `${dashboard.balance ?? 0} / 12`;

    return (
        <div className="mx-auto min-h-svh max-w-xl content-center px-6 py-12">
            <div className="grid gap-4 text-center">
                <PageIntro
                    title="Sin conexión"
                    explain={`Tus ${progress} sellos siguen en la cadena. Esta pantalla vuelve sola cuando haya señal.`}
                />

                <section className="consumer-panel grid gap-3 p-4">
                    <StateStrip tone="offline">
                        Guardado en este teléfono
                    </StateStrip>
                    <div className="grid gap-2">
                        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                            <span className="text-sm">Tu progreso</span>
                            <span className="font-semibold mono">
                                {progress}
                            </span>
                        </div>
                        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                            <span className="text-sm">
                                Últimas 4 operaciones
                            </span>
                            <Link
                                className="guide-btn guide-btn--ghost"
                                href="/history"
                            >
                                Ver
                            </Link>
                        </div>
                    </div>
                </section>

                <Link className="guide-btn guide-btn--ghost" href="/home">
                    Reintentar
                </Link>
            </div>
        </div>
    );
}

export default function OfflinePage() {
    const sessionQuery = authClient.useSession();
    const userId = sessionQuery.data?.user.id;

    const dashboard = useMemo<Dashboard | null>(() => {
        if (!userId || typeof window === "undefined") return null;

        return readPunchSnapshot<Dashboard>(
            window.localStorage,
            userId,
            "dashboard",
        );
    }, [userId]);

    if (!dashboard) {
        return <OfflineEmptyState />;
    }

    return <OfflineContent dashboard={dashboard} />;
}
