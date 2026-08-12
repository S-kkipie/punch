"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCafeProducts, useCafes } from "@/core/cafe/client/hooks";
import type { Cafe, Product } from "@/core/cafe/domain/types";
import { sortCafesByDistance } from "@/frontend/components/consumer/discovery-distance";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Button } from "@/frontend/components/ui/button";
import { Spinner } from "@/frontend/components/ui/spinner";

function formatProductLine(products: Product[]) {
    const shown = products
        .filter(
            (product) =>
                product.approvalStatus === "approved" && product.active,
        )
        .slice(0, 2)
        .map((product) => `${product.name} S/${product.priceSoles}`);

    return shown.length > 0 ? shown.join(" · ") : "Sin productos disponibles";
}

function DiscoverCafeCard({ cafe }: { cafe: Cafe }) {
    const productsQuery = useCafeProducts(cafe.id);
    const products = (productsQuery.data ?? []) as Product[];
    const productLine = useMemo(() => {
        if (productsQuery.isPending) return "Cargando productos";
        if (productsQuery.isError || !productsQuery.data) {
            return "Sin productos cargados";
        }
        return formatProductLine(products);
    }, [
        productsQuery.data,
        productsQuery.isError,
        productsQuery.isPending,
        products,
    ]);

    return (
        <Link
            className="grid gap-0 overflow-hidden"
            href={`/discover/${cafe.id}`}
        >
            <div className="consumer-panel p-0">
                {cafe.photoUrl ? (
                    // biome-ignore lint/performance/noImgElement: Café photos use user-provided external URLs.
                    <img
                        src={cafe.photoUrl}
                        alt={cafe.name}
                        className="h-44 w-full border-b border-[var(--color-rule)] object-cover"
                    />
                ) : (
                    <div className="flex h-44 items-center justify-center bg-[var(--color-paper-2)] text-[var(--color-ink-2)] text-sm">
                        Sin foto
                    </div>
                )}
                <div className="grid gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                        <span className="consumer-title text-xl">
                            {cafe.name}
                        </span>
                        <span className="consumer-eyebrow">Aliada</span>
                    </div>
                    <p className="text-[var(--color-ink-2)] text-sm">
                        {cafe.description ||
                            "Café independiente de la red PUNCH."}
                    </p>
                    <span className="mono sm text-[var(--color-accent)]">
                        {productLine}
                    </span>
                </div>
            </div>
        </Link>
    );
}

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
            <PageIntro
                eyebrow={`${cafes.length} cafeterías, un solo cartón`}
                title="Descubre cafés"
                explain="Todas son independientes y de barrio. Tus sellos valen igual en las cuatro."
            />
            {!position ? (
                <Button
                    className="min-h-11 border border-[var(--color-rule)]"
                    variant="outline"
                    onClick={requestLocation}
                >
                    📍 Ordenar por cercanía
                </Button>
            ) : null}
            {locationDenied && (
                <p className="text-[var(--color-ink-2)] text-sm">
                    Puedes seguir explorando por distrito.
                </p>
            )}
            {cafes.length === 0 ? (
                <EmptyState
                    mark="🗺️"
                    title="No hay cafés en esta zona"
                    cause="Conecta cafés aliados para que aparezcan aquí."
                    action={{ label: "Ver más rutas", href: "/crawls" }}
                />
            ) : (
                [...byDistrict.entries()].map(([district, districtCafes]) => (
                    <section key={district} className="space-y-3">
                        <h2 className="consumer-eyebrow">{district}</h2>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {districtCafes.map((cafe) => (
                                <DiscoverCafeCard key={cafe.id} cafe={cafe} />
                            ))}
                        </div>
                    </section>
                ))
            )}
        </div>
    );
}
