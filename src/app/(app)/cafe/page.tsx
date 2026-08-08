"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCreateCafe, useMyCafes } from "@/core/cafe/client/hooks";
import { CafeForm, type CafeFormValues } from "@/core/cafe/client/ui/cafe-form";
import { StatusBadge } from "@/core/cafe/client/ui/status-badge";
import type { CafeAdmin } from "@/core/cafe/domain/types";
import { Button } from "@/frontend/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function MyCafesPage() {
    const router = useRouter();
    const cafesQuery = useMyCafes();
    const createCafe = useCreateCafe();
    const [creating, setCreating] = useState(false);
    const cafes = (cafesQuery.data ?? []) as CafeAdmin[];

    const create = async (values: CafeFormValues) => {
        await createCafe.mutateAsync({
            name: values.name,
            description: values.description || undefined,
        });
        setCreating(false);
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
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="font-semibold text-2xl">Mis cafés</h1>
                    <p className="text-muted-foreground">
                        Completa tu perfil y catálogo para enviar tu café a
                        revisión.
                    </p>
                </div>
                <Button onClick={() => setCreating((value) => !value)}>
                    {creating ? "Cancelar" : "Crear café"}
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
                        />
                    </CardContent>
                </Card>
            )}
            {cafes.length === 0 && !creating ? (
                <Card>
                    <CardContent className="p-6 text-muted-foreground">
                        Todavía no tienes cafés registrados.
                    </CardContent>
                </Card>
            ) : (
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
                            <CardContent>
                                <p className="text-muted-foreground text-sm">
                                    {cafe.district || "Distrito pendiente"}
                                </p>
                                {cafe.reviewNote && (
                                    <p className="mt-2 text-destructive text-sm">
                                        {cafe.reviewNote}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
