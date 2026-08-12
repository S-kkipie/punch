"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCafe, useCafeProducts } from "@/core/cafe/client/hooks";
import type { Cafe, Product } from "@/core/cafe/domain/types";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Button } from "@/frontend/components/ui/button";
import { Spinner } from "@/frontend/components/ui/spinner";

function ProductSection({
    title,
    products,
    emptyMessage,
    caption,
    linkToRedeem = false,
    cafeId,
}: {
    title: string;
    products: Product[];
    emptyMessage: string;
    caption: string;
    linkToRedeem?: boolean;
    cafeId?: string;
}) {
    return (
        <section className="grid gap-3">
            <h2 className="consumer-title text-2xl">{title}</h2>
            {products.length === 0 ? (
                <p className="text-[var(--color-ink-2)] text-sm">
                    {emptyMessage}
                </p>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                    {products.map((product) => {
                        if (linkToRedeem && cafeId) {
                            return (
                                <Link
                                    key={product.id}
                                    href={`/redeem/${product.id}?cafeId=${cafeId}`}
                                >
                                    <article className="consumer-panel grid gap-2 p-4">
                                        <h3 className="font-semibold">
                                            {product.name}
                                        </h3>
                                        <p className="text-[var(--color-ink-2)] text-sm">
                                            {product.description ||
                                                "Sin descripción"}
                                        </p>
                                        <p className="font-medium">
                                            S/{product.priceSoles}
                                        </p>
                                        <p className="text-[var(--color-ink-2)] text-xs">
                                            {caption}
                                        </p>
                                    </article>
                                </Link>
                            );
                        }

                        return (
                            <article
                                key={product.id}
                                className="consumer-panel grid gap-2 p-4"
                            >
                                <h3 className="font-semibold">
                                    {product.name}
                                </h3>
                                <p className="text-[var(--color-ink-2)] text-sm">
                                    {product.description || "Sin descripción"}
                                </p>
                                <p className="font-medium">
                                    S/{product.priceSoles}
                                </p>
                                <p className="text-[var(--color-ink-2)] text-xs">
                                    {caption}
                                </p>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

export default function DiscoverCafePage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const cafeQuery = useCafe(cafeId);
    const productsQuery = useCafeProducts(cafeId);

    if (cafeQuery.isLoading || productsQuery.isLoading) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    if (cafeQuery.isError || productsQuery.isError || !cafeQuery.data) {
        return (
            <p className="p-6 text-destructive">No se pudo cargar este café.</p>
        );
    }

    const cafe = cafeQuery.data as Cafe;
    const products = ((productsQuery.data ?? []) as Product[]).filter(
        (product) => product.approvalStatus === "approved" && product.active,
    );
    const emissionProducts = products.filter(
        (product) => product.type === "emission",
    );
    const rewardProducts = products.filter(
        (product) => product.type === "reward",
    );

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
            <Button asChild variant="ghost">
                <Link href="/discover">Volver a descubrir</Link>
            </Button>
            <article className="consumer-panel grid gap-0 overflow-hidden">
                {cafe.photoUrl ? (
                    // biome-ignore lint/performance/noImgElement: Café photos use user-provided external URLs.
                    <img
                        src={cafe.photoUrl}
                        alt={cafe.name}
                        className="h-64 w-full object-cover"
                    />
                ) : null}
                <div className="grid gap-2 p-6">
                    <div className="flex items-start justify-between gap-2">
                        <h1 className="consumer-title text-4xl">{cafe.name}</h1>
                        <span className="consumer-eyebrow">Aliada</span>
                    </div>
                    <p className="text-[var(--color-ink-2)]">
                        {cafe.description ||
                            "Café independiente de la red PUNCH."}
                    </p>
                    {cafe.address && (
                        <p className="text-[var(--color-ink-2)] text-sm">
                            {cafe.address}
                        </p>
                    )}
                </div>
            </article>
            <PageIntro
                eyebrow="Productos"
                title={cafe.name}
                explain="Elige en qué comprar para sumar sellos y avanzar en tus campañas."
            />
            <ProductSection
                title="Productos que dan PUNCH"
                products={emissionProducts}
                emptyMessage="Sin productos de emisión por ahora."
                caption="Emite 1 PUNCH"
            />
            <ProductSection
                title="Recompensas (12 PUNCH)"
                products={rewardProducts}
                emptyMessage="Sin recompensas publicadas por ahora."
                caption="Costo fijo: 12 PUNCH"
                linkToRedeem
                cafeId={cafe.id}
            />
        </div>
    );
}
