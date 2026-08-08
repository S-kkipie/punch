"use client";

import Link from "next/link";
import { useCafes } from "@/core/cafe/client/hooks";
import type { Cafe } from "@/core/cafe/domain/types";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function DiscoverPage() {
    const cafesQuery = useCafes();

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
                No se pudieron cargar los cafés.
            </p>
        );
    }

    const cafes = (cafesQuery.data ?? []) as Cafe[];
    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
            <div>
                <h1 className="font-semibold text-2xl">Descubre cafés</h1>
                <p className="text-muted-foreground">
                    Conoce cafés independientes y sus productos de impacto.
                </p>
            </div>
            {cafes.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-muted-foreground">
                        Todavía no hay cafés aprobados.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {cafes.map((cafe) => (
                        <Link key={cafe.id} href={`/discover/${cafe.id}`}>
                            <Card className="h-full overflow-hidden transition hover:border-primary">
                                {cafe.photoUrl ? (
                                    // biome-ignore lint/performance/noImgElement: Café photos use user-provided external URLs.
                                    <img
                                        src={cafe.photoUrl}
                                        alt={cafe.name}
                                        className="h-44 w-full object-cover"
                                    />
                                ) : (
                                    <div className="flex h-44 items-center justify-center bg-muted text-muted-foreground text-sm">
                                        Sin foto
                                    </div>
                                )}
                                <CardHeader>
                                    <CardTitle>{cafe.name}</CardTitle>
                                    <p className="text-muted-foreground text-sm">
                                        {cafe.district || "Distrito pendiente"}
                                    </p>
                                </CardHeader>
                                <CardContent>
                                    <p className="line-clamp-3 text-sm">
                                        {cafe.description ||
                                            "Café independiente de la red PUNCH."}
                                    </p>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
