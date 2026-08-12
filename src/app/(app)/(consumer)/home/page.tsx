"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMyCafes } from "@/core/cafe/client/hooks";
import { useDashboard } from "@/core/punch/client/hooks";
import { PunchMeter } from "@/core/punch/client/ui/punch-meter";
import type { Dashboard } from "@/core/punch/domain/types";
import { authClient } from "@/frontend/auth/auth";
import {
    readPunchSnapshot,
    writePunchSnapshot,
} from "@/frontend/components/consumer/offline-snapshot";
import { JourneyCard } from "@/frontend/components/guide/journey-card";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Button } from "@/frontend/components/ui/button";
import { Spinner } from "@/frontend/components/ui/spinner";

export function postAuthDestination(
    cafes: Array<{ id: string; onboardingStatus: string }>,
): string {
    const cafe = [...cafes].sort((a, b) => {
        const approvedOrder =
            Number(b.onboardingStatus === "approved") -
            Number(a.onboardingStatus === "approved");
        return approvedOrder || a.id.localeCompare(b.id);
    })[0];
    if (!cafe) return "/home";
    return cafe.onboardingStatus === "approved"
        ? `/cafe/${cafe.id}/terminal`
        : `/cafe/${cafe.id}`;
}

export default function HomePage() {
    const dashboardQuery = useDashboard();
    const myCafesQuery = useMyCafes();
    const sessionQuery = authClient.useSession();
    const [savedDashboard, setSavedDashboard] = useState<Dashboard | null>(
        null,
    );
    const [lastKnownDashboard, setLastKnownDashboard] =
        useState<Dashboard | null>(null);
    const userId = sessionQuery.data?.user.id;

    useEffect(() => {
        if (!userId || typeof window === "undefined") return;
        const dashboardData = dashboardQuery.data as Dashboard | undefined;
        if (dashboardData) {
            if (
                dashboardData.balance !== null &&
                lastKnownDashboard?.balance !== dashboardData.balance
            ) {
                setLastKnownDashboard(dashboardData);
            }
            writePunchSnapshot(
                window.localStorage,
                userId,
                "dashboard",
                dashboardData,
            );
        } else if (dashboardQuery.isError && navigator.onLine === false) {
            setSavedDashboard(
                readPunchSnapshot<Dashboard>(
                    window.localStorage,
                    userId,
                    "dashboard",
                ),
            );
        }
    }, [
        dashboardQuery.data,
        dashboardQuery.isError,
        lastKnownDashboard,
        userId,
    ]);

    if (myCafesQuery.isPending) {
        return (
            <div className="flex min-h-64 items-center justify-center">
                <span className="sr-only">Cargando</span>
                <Spinner />
            </div>
        );
    }
    if (dashboardQuery.isError && !savedDashboard) {
        return (
            <div className="consumer-panel grid gap-4 p-6 text-center">
                <p>
                    No se pudo cargar tu progreso. Conéctate para actualizarlo.
                </p>
                <Button onClick={() => dashboardQuery.refetch()}>
                    Reintentar
                </Button>
            </div>
        );
    }
    if (!dashboardQuery.data && !savedDashboard) {
        return (
            <div className="consumer-panel grid gap-3 p-6">
                <h1 className="consumer-title text-3xl font-bold">
                    Tu recorrido empieza aquí
                </h1>
                <p>
                    Aún no tenemos actividad para mostrarte. Visita una
                    cafetería aliada y escanea tu primera compra.
                </p>
                <Button asChild>
                    <Link href="/discover">Descubrir cafeterías</Link>
                </Button>
            </div>
        );
    }

    const dashboard = (dashboardQuery.data ?? savedDashboard) as Dashboard;
    const knownDashboard =
        dashboard.balance === null ? lastKnownDashboard : dashboard;
    const displayDashboard = knownDashboard ?? dashboard;
    return (
        <div className="grid gap-6">
            {dashboard.stale && (
                <p
                    className="rounded-md bg-[var(--color-surface-2)] p-3 text-sm"
                    role="status"
                >
                    Actualizando desde la cadena
                </p>
            )}
            {savedDashboard && !dashboardQuery.data && (
                <p
                    className="rounded-md bg-[var(--color-surface-2)] p-3 text-sm"
                    role="status"
                >
                    Datos guardados · Conéctate para actualizar
                </p>
            )}
            <PageIntro
                eyebrow="Tu mesa, tu barrio"
                title="Hola de nuevo"
                explain="Cada compra en una cafetería aliada te da un sello. Con 12 sellos canjeas un café — y la red de cafeterías lo respalda en la cadena."
            />
            {displayDashboard.balance !== null && (
                <PunchMeter balance={displayDashboard.balance} />
            )}
            <Button asChild size="lg" className="min-h-12 w-full text-base">
                <Link href="/scan">
                    Escanear compra <span aria-hidden="true">→</span>
                </Link>
            </Button>
            <JourneyCard currentRole="cliente" />
            <div className="grid gap-4 sm:grid-cols-2">
                {dashboard.activeCampaign ? (
                    <section className="consumer-panel grid gap-3 p-5">
                        <span className="consumer-eyebrow">Campaña activa</span>
                        <h2 className="consumer-title text-2xl font-bold">
                            {dashboard.activeCampaign.name}
                        </h2>
                        <Link
                            className="font-semibold text-[var(--color-accent)] underline"
                            href={`/campaigns/${dashboard.activeCampaign.id}`}
                        >
                            Ver campaña
                        </Link>
                    </section>
                ) : (
                    <section className="consumer-panel grid gap-3 p-5">
                        <span className="consumer-eyebrow">Campañas</span>
                        <h2 className="consumer-title text-2xl font-bold">
                            Algo nuevo puede estar cerca
                        </h2>
                        <Link
                            className="font-semibold text-[var(--color-accent)] underline"
                            href="/campaigns"
                        >
                            Explorar campañas
                        </Link>
                    </section>
                )}
                {dashboard.activeCrawl ? (
                    <section className="consumer-panel consumer-voucher grid gap-3 p-5">
                        <span className="consumer-eyebrow">Ruta de café</span>
                        <h2 className="consumer-title text-2xl font-bold">
                            {dashboard.activeCrawl.name}
                        </h2>
                        <p>
                            {dashboard.activeCrawl.completedSteps} de{" "}
                            {dashboard.activeCrawl.totalSteps} cafés visitados
                        </p>
                        <Link
                            className="font-semibold text-[var(--color-accent)] underline"
                            href={`/crawls/${dashboard.activeCrawl.id}`}
                        >
                            Seguir la ruta
                        </Link>
                    </section>
                ) : (
                    <section className="consumer-panel consumer-voucher grid gap-3 p-5">
                        <span className="consumer-eyebrow">Rutas</span>
                        <h2 className="consumer-title text-2xl font-bold">
                            Conoce cafés nuevos
                        </h2>
                        <Link
                            className="font-semibold text-[var(--color-accent)] underline"
                            href="/crawls"
                        >
                            Ver rutas de café
                        </Link>
                    </section>
                )}
            </div>
        </div>
    );
}
