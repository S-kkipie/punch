"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCafe, useCafeProducts } from "@/core/cafe/client/hooks";
import type { Cafe, Product } from "@/core/cafe/domain/types";
import { Button } from "@/frontend/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";
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
        <section className="space-y-4">
            <h2 className="font-semibold text-xl">{title}</h2>
            {products.length === 0 ? (
                <p className="text-muted-foreground text-sm">{emptyMessage}</p>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                    {products.map((product) => {
                        const card = (
                            <Card key={product.id}>
                                <CardHeader>
                                    <CardTitle>{product.name}</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {product.description && (
                                        <p className="text-muted-foreground text-sm">
                                            {product.description}
                                        </p>
                                    )}
                                    <p className="font-medium">
                                        S/ {product.priceSoles}
                                    </p>
                                    <p className="text-muted-foreground text-sm">
                                        {caption}
                                    </p>
                                </CardContent>
                            </Card>
                        );
                        return linkToRedeem && cafeId ? (
                            <Link
                                key={product.id}
                                href={`/redeem/${product.id}?cafeId=${cafeId}`}
                            >
                                {card}
                            </Link>
                        ) : (
                            <div key={product.id}>{card}</div>
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

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
            <Button asChild variant="ghost">
                <Link href="/discover">Volver a descubrir</Link>
            </Button>
            <Card className="overflow-hidden">
                {cafe.photoUrl && (
                    // biome-ignore lint/performance/noImgElement: Café photos use user-provided external URLs.
                    <img
                        src={cafe.photoUrl}
                        alt={cafe.name}
                        className="h-64 w-full object-cover"
                    />
                )}
                <CardHeader>
                    <CardTitle className="text-3xl">{cafe.name}</CardTitle>
                    <p className="text-muted-foreground">
                        {cafe.district || "Distrito pendiente"}
                    </p>
                </CardHeader>
                <CardContent>
                    <p>
                        {cafe.description ||
                            "Café independiente de la red PUNCH."}
                    </p>
                    {cafe.address && (
                        <p className="mt-2 text-muted-foreground text-sm">
                            {cafe.address}
                        </p>
                    )}
                </CardContent>
            </Card>
            <ProductSection
                title="Productos que dan PUNCH"
                products={products.filter(
                    (product) => product.type === "emission",
                )}
                emptyMessage="Sin productos de emisión por ahora."
                caption="Emite 1 PUNCH"
            />
            <ProductSection
                title="Recompensas (12 PUNCH)"
                products={products.filter(
                    (product) => product.type === "reward",
                )}
                emptyMessage="Sin recompensas publicadas por ahora."
                caption="Costo fijo: 12 PUNCH"
                linkToRedeem
                cafeId={cafe.id}
            />
        </div>
    );
}
