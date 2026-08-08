"use client";

import { usePendingProducts, useReviewQueue } from "@/core/cafe/client/hooks";
import { ReviewCard } from "@/core/cafe/client/ui/review-card";
import type { CafeAdmin, Product } from "@/core/cafe/domain/types";
import { Card, CardContent } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

function errorStatus(error: unknown): number | undefined {
    const value = error as {
        status?: number;
        value?: { status?: number };
    } | null;
    return value?.status ?? value?.value?.status;
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
                <Card>
                    <CardContent className="p-6">
                        <p className="font-medium">
                            {unauthorized
                                ? "No autorizado"
                                : "No se pudo cargar la consola"}
                        </p>
                        <p className="mt-1 text-muted-foreground text-sm">
                            {unauthorized
                                ? "Esta consola está disponible únicamente para operaciones."
                                : "Intenta nuevamente en unos momentos."}
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const cafes = (cafesQuery.data ?? []) as CafeAdmin[];
    const products = (productsQuery.data ?? []) as Product[];

    return (
        <div className="mx-auto w-full max-w-5xl space-y-8 p-6">
            <div>
                <h1 className="font-semibold text-2xl">
                    Consola de operaciones
                </h1>
                <p className="text-muted-foreground">
                    Revisa y aprueba los cafés y productos enviados por la red.
                </p>
            </div>
            <section className="space-y-4">
                <div>
                    <h2 className="font-semibold text-xl">Cafés por revisar</h2>
                    <p className="text-muted-foreground text-sm">
                        {cafes.length}{" "}
                        {cafes.length === 1
                            ? "café pendiente"
                            : "cafés pendientes"}
                    </p>
                </div>
                {cafes.length === 0 ? (
                    <Card>
                        <CardContent className="p-6 text-muted-foreground">
                            No hay cafés pendientes.
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                        {cafes.map((cafe) => (
                            <ReviewCard key={cafe.id} kind="cafe" item={cafe} />
                        ))}
                    </div>
                )}
            </section>
            <section className="space-y-4">
                <div>
                    <h2 className="font-semibold text-xl">
                        Productos por revisar
                    </h2>
                    <p className="text-muted-foreground text-sm">
                        {products.length}{" "}
                        {products.length === 1
                            ? "producto pendiente"
                            : "productos pendientes"}
                    </p>
                </div>
                {products.length === 0 ? (
                    <Card>
                        <CardContent className="p-6 text-muted-foreground">
                            No hay productos pendientes.
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2">
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
