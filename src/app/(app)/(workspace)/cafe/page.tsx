"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ClientConfig } from "@/config/client-config";
import { useCreateCafe, useMyCafes } from "@/core/cafe/client/hooks";
import { CafeForm, type CafeFormValues } from "@/core/cafe/client/ui/cafe-form";
import { StatusBadge } from "@/core/cafe/client/ui/status-badge";
import type { CafeAdmin, CafeOnboardingStatus } from "@/core/cafe/domain/types";
import { DemoOnly } from "@/frontend/components/guide/demo-only";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Button } from "@/frontend/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

const reviewHint: Record<CafeOnboardingStatus, string | null> = {
    approved: null,
    draft: "Completa los datos y vuelve a enviar tu café para pasar la revisión.",
    submitted:
        "En revisión. Operaciones valida tu cafetería y luego podrás operar en la red.",
    rejected: "Rechazado. Corrige lo indicado y vuelve a enviarlo a revisión.",
};

export default function MyCafesPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const cafesQuery = useMyCafes();
    const createCafe = useCreateCafe();
    const [creating, setCreating] = useState(searchParams.get("new") === "1");
    const cafes = (cafesQuery.data ?? []) as CafeAdmin[];
    const approvedCafe = cafes.find(
        (cafe) => cafe.onboardingStatus === "approved",
    );

    useEffect(() => {
        setCreating(searchParams.get("new") === "1");
    }, [searchParams]);

    const create = async (values: CafeFormValues) => {
        await createCafe.mutateAsync({
            name: values.name,
            description: values.description || undefined,
        });
        setCreating(false);
        void router.replace("/cafe");
        void cafesQuery.refetch();
    };

    if (cafesQuery.isLoading) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    if (cafesQuery.isError) {
        return (
            <p className="p-6 text-destructive">
                No se pudieron cargar tus cafés.
            </p>
        );
    }

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
            <PageIntro
                eyebrow="Tu lugar en la red"
                title="Mis cafeterías"
                explain="Registra tu café, arma tu catálogo y envíalo a revisión.
                Operaciones lo aprueba y entras a la red."
            />

            {ClientConfig.demoMode && approvedCafe ? (
                <section className="consumer-panel grid gap-2 p-5">
                    <span className="consumer-eyebrow">Siguiente paso</span>
                    <p className="text-sm">
                        El código de compra se genera en la terminal. Abre la de{" "}
                        {approvedCafe.name} para cobrar la siguiente visita.
                    </p>
                    <Button asChild>
                        <Link href={`/cafe/${approvedCafe.id}/terminal`}>
                            Abrir terminal <span aria-hidden="true">→</span>
                        </Link>
                    </Button>
                    <DemoOnly />
                </section>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3">
                <Button onClick={() => setCreating((value) => !value)}>
                    {creating ? "Cancelar" : "Registrar cafetería"}
                </Button>
            </div>

            {creating && (
                <Card>
                    <CardHeader>
                        <CardTitle>Nuevo café</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <CafeForm
                            onSubmit={create}
                            disabled={createCafe.isPending}
                            fields={["name", "description"]}
                        />
                    </CardContent>
                </Card>
            )}

            {cafes.length === 0 && !creating ? (
                <EmptyState
                    mark="🏪"
                    title="¿Tienes otra cafetería?"
                    cause="Cada local se registra por separado: catálogo, canjes y fondo común propios."
                    action={{
                        label: "Registrar cafetería",
                        href: "/cafe?new=1",
                    }}
                />
            ) : null}

            {cafes.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                    {cafes.map((cafe) => (
                        <Card
                            key={cafe.id}
                            className="cursor-pointer transition hover:border-primary"
                            onClick={() => router.push(`/cafe/${cafe.id}`)}
                        >
                            <CardHeader className="flex-row items-start justify-between gap-3">
                                <CardTitle>{cafe.name}</CardTitle>
                                <StatusBadge status={cafe.onboardingStatus} />
                            </CardHeader>
                            <CardContent className="space-y-1">
                                <p className="text-muted-foreground text-sm">
                                    {cafe.district || "Distrito pendiente"}
                                </p>
                                {reviewHint[cafe.onboardingStatus] ? (
                                    <p className="text-sm text-amber-800">
                                        {reviewHint[cafe.onboardingStatus]}
                                    </p>
                                ) : null}
                                {cafe.reviewNote ? (
                                    <p className="mt-1 text-destructive text-sm">
                                        {cafe.reviewNote}
                                    </p>
                                ) : null}
                                {cafe.onboardingStatus === "approved" ? (
                                    <Button
                                        asChild
                                        variant="outline"
                                        size="sm"
                                        onClick={(event) =>
                                            event.stopPropagation()
                                        }
                                    >
                                        <Link
                                            href={`/cafe/${cafe.id}/terminal`}
                                        >
                                            Abrir terminal
                                        </Link>
                                    </Button>
                                ) : null}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
