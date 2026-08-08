"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCafes } from "@/core/cafe/client/hooks";
import type { Cafe } from "@/core/cafe/domain/types";
import { sortCafesByDistance } from "@/frontend/components/consumer/discovery-distance";
import { Button } from "@/frontend/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function DiscoverPage() {
    const cafesQuery = useCafes();
    const [position, setPosition] = useState<{
        lat: number;
        lng: number;
    } | null>(null);
    const [locationDenied, setLocationDenied] = useState(false);
    const cafes = (cafesQuery.data ?? []) as Cafe[];
    const sorted = useMemo(
        () => (position ? sortCafesByDistance(cafes, position) : cafes),
        [cafes, position],
    );
    const byDistrict = useMemo(() => {
        const groups = new Map<string, Cafe[]>();
        for (const cafe of sorted) {
            const district = cafe.district || "Otros distritos";
            groups.set(district, [...(groups.get(district) ?? []), cafe]);
        }
        return groups;
    }, [sorted]);

    const requestLocation = () => {
        if (!("geolocation" in navigator)) {
            setLocationDenied(true);
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (positionValue) =>
                setPosition({
                    lat: positionValue.coords.latitude,
                    lng: positionValue.coords.longitude,
                }),
            () => setLocationDenied(true),
        );
    };

    if (cafesQuery.isLoading)
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    if (cafesQuery.isError)
        return (
            <p className="p-6 text-destructive">
                No se pudieron cargar los cafés.
            </p>
        );

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="font-semibold text-2xl">Descubre cafés</h1>
                    <p className="text-muted-foreground">
                        Conoce cafés independientes y sus productos de impacto.
                    </p>
                </div>
                {!position && (
                    <Button
                        className="min-h-11"
                        variant="outline"
                        onClick={requestLocation}
                    >
                        Cerca de mí
                    </Button>
                )}
            </div>
            {locationDenied && (
                <p className="text-muted-foreground text-sm">
                    Puedes seguir explorando por distrito.
                </p>
            )}
            {cafes.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-muted-foreground">
                        Todavía no hay cafés aprobados.
                    </CardContent>
                </Card>
            ) : (
                [...byDistrict.entries()].map(([district, districtCafes]) => (
                    <section key={district} className="space-y-3">
                        <h2 className="font-medium text-lg">{district}</h2>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {districtCafes.map((cafe) => (
                                <Link
                                    key={cafe.id}
                                    href={`/discover/${cafe.id}`}
                                >
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
                    </section>
                ))
            )}
        </div>
    );
}
