"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import {
    useCafe,
    useCafeProducts,
    useCreateProduct,
    useSubmitCafe,
    useUpdateCafe,
} from "@/core/cafe/client/hooks";
import { CafeForm, type CafeFormValues } from "@/core/cafe/client/ui/cafe-form";
import {
    ProductForm,
    type ProductFormValues,
} from "@/core/cafe/client/ui/product-form";
import { ProductList } from "@/core/cafe/client/ui/product-list";
import { StatusBadge } from "@/core/cafe/client/ui/status-badge";
import { submissionGaps } from "@/core/cafe/domain/transitions";
import type { CafeAdmin, ProductAdmin } from "@/core/cafe/domain/types";
import { Button } from "@/frontend/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

function responseTargets(error: unknown): string[] {
    const value = error as {
        value?: { targets?: string[] };
        targets?: string[];
    } | null;
    return value?.value?.targets ?? value?.targets ?? [];
}

export default function CafePanelPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const cafeQuery = useCafe(cafeId);
    const productsQuery = useCafeProducts(cafeId);
    const updateCafe = useUpdateCafe(cafeId);
    const createProduct = useCreateProduct(cafeId);
    const submitCafe = useSubmitCafe(cafeId);
    const cafe = cafeQuery.data as CafeAdmin | undefined;
    const products = (productsQuery.data ?? []) as ProductAdmin[];

    const localGaps = useMemo(
        () =>
            cafe
                ? submissionGaps(
                      cafe,
                      products.filter((product) => product.type === "emission")
                          .length,
                  )
                : [],
        [cafe, products],
    );
    const serverGaps = responseTargets(submitCafe.error);
    const gaps = serverGaps.length > 0 ? serverGaps : localGaps;
    const gapLabels: Record<string, string> = {
        name: "Nombre",
        address: "Dirección",
        district: "Distrito",
        contactPhone: "Teléfono de contacto",
        emissionProduct: "Al menos un producto de emisión",
    };

    if (
        cafeQuery.isPending ||
        cafeQuery.isFetching ||
        productsQuery.isPending ||
        productsQuery.isFetching
    ) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    if (cafeQuery.isError || !cafe) {
        return (
            <p className="p-6 text-destructive">No se pudo cargar el café.</p>
        );
    }

    const saveCafe = (values: CafeFormValues) => {
        const patch = {
            name: values.name,
            description: values.description || null,
            address: values.address || null,
            district: values.district || null,
            contactPhone: values.contactPhone || null,
            ruc: values.ruc || null,
            photoUrl: values.photoUrl || null,
        };
        if (cafe.onboardingStatus === "approved") {
            updateCafe.mutate({
                description: patch.description,
                contactPhone: patch.contactPhone,
                photoUrl: patch.photoUrl,
            });
            return;
        }
        updateCafe.mutate(patch);
    };
    const addProduct = (values: ProductFormValues) =>
        createProduct.mutate({
            ...values,
            cogsSoles: values.cogsSoles || undefined,
        });

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="font-semibold text-2xl">{cafe.name}</h1>
                    <p className="text-muted-foreground">Panel del café</p>
                </div>
                <StatusBadge status={cafe.onboardingStatus} />
            </div>
            {cafe.onboardingStatus === "rejected" && cafe.reviewNote && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800 text-sm">
                    Motivo del rechazo: {cafe.reviewNote}
                </p>
            )}
            <Card>
                <CardHeader>
                    <CardTitle>Perfil del café</CardTitle>
                </CardHeader>
                <CardContent>
                    <CafeForm
                        defaultValues={{
                            name: cafe.name,
                            description: cafe.description ?? "",
                            address: cafe.address ?? "",
                            district: cafe.district ?? "",
                            contactPhone: cafe.contactPhone ?? "",
                            ruc: cafe.ruc ?? "",
                            photoUrl: cafe.photoUrl ?? "",
                        }}
                        onSubmit={saveCafe}
                        disabled={
                            updateCafe.isPending ||
                            cafe.onboardingStatus === "submitted"
                        }
                        fields={
                            cafe.onboardingStatus === "approved"
                                ? ["description", "contactPhone", "photoUrl"]
                                : undefined
                        }
                    />
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Catálogo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <ProductList cafeId={cafeId} products={products} />
                    <div className="border-t pt-6">
                        <ProductForm
                            onSubmit={addProduct}
                            disabled={
                                createProduct.isPending ||
                                cafe.onboardingStatus === "submitted"
                            }
                        />
                    </div>
                </CardContent>
            </Card>
            {cafe.onboardingStatus !== "approved" &&
                cafe.onboardingStatus !== "submitted" && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Enviar a revisión</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {gaps.length > 0 && (
                                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900 text-sm">
                                    <p className="font-medium">
                                        Completa estos datos antes de enviar:
                                    </p>
                                    <ul className="mt-2 list-inside list-disc">
                                        {gaps.map((gap) => (
                                            <li key={gap}>
                                                {gapLabels[gap] ??
                                                    "Dato requerido"}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <Button
                                disabled={
                                    gaps.length > 0 || submitCafe.isPending
                                }
                                onClick={() => submitCafe.mutate()}
                            >
                                {submitCafe.isPending
                                    ? "Enviando…"
                                    : "Enviar a revisión"}
                            </Button>
                        </CardContent>
                    </Card>
                )}
        </div>
    );
}
