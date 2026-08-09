"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCafes } from "@/core/cafe/client/hooks";
import type { Cafe } from "@/core/cafe/domain/types";
import { sortCafesByDistance } from "@/frontend/components/consumer/discovery-distance";
import { Button } from "@/frontend/components/ui/button";
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
        <div className="mx-auto grid w-full max-w-6xl gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <section className="grid gap-2">
                    <span className="consumer-eyebrow">Cerca de ti</span>
                    <h1 className="consumer-title text-4xl font-bold tracking-tight">
                        Descubre cafés
                    </h1>
                    <p className="text-[var(--color-ink-2)]">
                        Conoce cafés independientes y sus productos de impacto.
                    </p>
                </section>
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
                <p className="text-[var(--color-ink-2)] text-sm">
                    Puedes seguir explorando por distrito.
                </p>
            )}
            {cafes.length === 0 ? (
                <div className="consumer-panel p-6 text-[var(--color-ink-2)]">
                    Todavía no hay cafés aprobados.
                </div>
            ) : (
                [...byDistrict.entries()].map(([district, districtCafes]) => (
                    <section key={district} className="grid gap-3">
                        <h2 className="consumer-title text-lg font-bold">
                            {district}
                        </h2>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {districtCafes.map((cafe) => (
                                <Link
                                    key={cafe.id}
                                    className="consumer-panel grid h-full grid-rows-[11rem_auto] overflow-hidden transition hover:-translate-y-0.5"
                                    href={`/discover/${cafe.id}`}
                                >
                                    {cafe.photoUrl ? (
                                        // biome-ignore lint/performance/noImgElement: Café photos use user-provided external URLs.
                                        <img
                                            src={cafe.photoUrl}
                                            alt={cafe.name}
                                            className="h-44 w-full border-[var(--color-rule)] border-b object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-44 items-center justify-center border-[var(--color-rule)] border-b bg-[var(--color-paper-2)] text-[var(--color-ink-2)] text-sm">
                                            Sin foto
                                        </div>
                                    )}
                                    <div className="grid gap-2 p-5">
                                        <p className="consumer-title font-bold text-xl">
                                            {cafe.name}
                                        </p>
                                        <p className="line-clamp-3 text-[var(--color-ink-2)] text-sm">
                                            {cafe.description ||
                                                "Café independiente de la red PUNCH."}
                                        </p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </section>
                ))
            )}
        </div>
    );
}
