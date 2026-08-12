"use client";

import { usePendingProducts, useReviewQueue } from "@/core/cafe/client/hooks";
import { ReviewCard } from "@/core/cafe/client/ui/review-card";
import type { CafeAdmin, Product } from "@/core/cafe/domain/types";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Spinner } from "@/frontend/components/ui/spinner";

function errorStatus(error: unknown): number | undefined {
    const value = error as {
        status?: number;
        value?: { status?: number };
    } | null;
    return value?.status ?? value?.value?.status;
}

function pluralHint(count: number, singular: string, plural: string): string {
    return count === 1 ? singular : plural;
}

export default function OpsPage() {
    const cafesQuery = useReviewQueue();
    const productsQuery = usePendingProducts();

    if (cafesQuery.isLoading || productsQuery.isLoading) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }

    if (cafesQuery.isError || productsQuery.isError) {
        const status =
            errorStatus(cafesQuery.error) ?? errorStatus(productsQuery.error);
        const unauthorized = status === 403;
        return (
            <div className="mx-auto w-full max-w-5xl p-6">
                <section className="consumer-panel grid gap-2 p-4">
                    <span className="consumer-eyebrow">
                        Consola de operaciones
                    </span>
                    <p className="font-medium">
                        {unauthorized
                            ? "No autorizado"
                            : "No se pudo cargar la consola"}
                    </p>
                    <p className="mt-1 text-[var(--color-ink-2)] text-sm">
                        {unauthorized
                            ? "Esta consola está disponible únicamente para operaciones."
                            : "Intenta nuevamente en unos momentos."}
                    </p>
                </section>
            </div>
        );
    }

    const cafes = (cafesQuery.data ?? []) as CafeAdmin[];
    const products = (productsQuery.data ?? []) as Product[];

    return (
        <div className="mx-auto grid w-full max-w-5xl gap-8 p-6">
            <PageIntro
                eyebrow="Cola de revisión"
                title="Consola de operaciones"
                explain="Aprueba las cafeterías y productos que la red envía."
            />

            <section className="guide-stat-row">
                <article className="guide-stat">
                    <span className="guide-stat__label">Cafeterías</span>
                    <span className="guide-stat__value">{cafes.length}</span>
                    <span className="guide-stat__hint">
                        {pluralHint(cafes.length, "pendiente", "pendientes")}
                    </span>
                </article>
                <article className="guide-stat">
                    <span className="guide-stat__label">Productos</span>
                    <span className="guide-stat__value">{products.length}</span>
                    <span className="guide-stat__hint">
                        {pluralHint(products.length, "pendiente", "pendientes")}
                    </span>
                </article>
            </section>

            <section className="consumer-panel grid gap-3 p-4">
                <span className="consumer-eyebrow">Cafés por revisar</span>
                {cafes.length === 0 ? (
                    <p className="text-[var(--color-ink-2)]">
                        No hay cafés pendientes.
                    </p>
                ) : (
                    <div className="grid gap-4">
                        {cafes.map((cafe) => (
                            <ReviewCard key={cafe.id} kind="cafe" item={cafe} />
                        ))}
                    </div>
                )}
            </section>

            <section className="consumer-panel grid gap-3 p-4">
                <span className="consumer-eyebrow">Productos por revisar</span>
                {products.length === 0 ? (
                    <p className="text-[var(--color-ink-2)]">
                        No hay productos pendientes.
                    </p>
                ) : (
                    <div className="grid gap-4">
                        {products.map((product) => (
                            <ReviewCard
                                key={product.id}
                                kind="product"
                                item={product}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
