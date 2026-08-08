"use client";

import { useState } from "react";
import { useUpdateProduct } from "@/core/cafe/client/hooks";
import {
    ProductForm,
    type ProductFormValues,
} from "@/core/cafe/client/ui/product-form";
import type { ProductAdmin } from "@/core/cafe/domain/types";
import { Badge } from "@/frontend/components/ui/badge";
import { Button } from "@/frontend/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/frontend/components/ui/table";

const approvalLabels = {
    pending: "Pendiente",
    approved: "Aprobado",
    rejected: "Rechazado",
} as const;

export function ProductList({
    cafeId,
    products,
}: {
    cafeId: string;
    products: ProductAdmin[];
}) {
    const [editingProductId, setEditingProductId] = useState<string | null>(
        null,
    );
    const updateProduct = useUpdateProduct(cafeId);

    if (products.length === 0) {
        return (
            <p className="text-muted-foreground text-sm">
                Aún no tienes productos.
            </p>
        );
    }

    const saveProduct = (productId: string, values: ProductFormValues) => {
        updateProduct.mutate(
            {
                productId,
                ...values,
                cogsSoles: values.cogsSoles || undefined,
            },
            { onSuccess: () => setEditingProductId(null) },
        );
    };

    return (
        <div className="overflow-x-auto rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Precio</TableHead>
                        <TableHead>COGS</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {products.map((product) => (
                        <TableRow key={product.id}>
                            <TableCell>
                                <div className="font-medium">
                                    {product.name}
                                </div>
                                {product.description && (
                                    <div className="text-muted-foreground text-xs">
                                        {product.description}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell>
                                {product.type === "reward"
                                    ? "Recompensa"
                                    : "Emisión"}
                            </TableCell>
                            <TableCell>S/ {product.priceSoles}</TableCell>
                            <TableCell>
                                {product.cogsSoles
                                    ? `S/ ${product.cogsSoles}`
                                    : "—"}
                            </TableCell>
                            <TableCell>
                                <Badge
                                    variant={
                                        product.approvalStatus === "approved"
                                            ? "default"
                                            : "secondary"
                                    }
                                >
                                    {approvalLabels[product.approvalStatus]}
                                </Badge>
                                {!product.active && (
                                    <p className="mt-1 text-muted-foreground text-xs">
                                        Inactivo
                                    </p>
                                )}
                                {product.reviewNote && (
                                    <p className="mt-1 text-muted-foreground text-xs">
                                        Motivo: {product.reviewNote}
                                    </p>
                                )}
                            </TableCell>
                            <TableCell>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            setEditingProductId(
                                                editingProductId === product.id
                                                    ? null
                                                    : product.id,
                                            )
                                        }
                                    >
                                        {editingProductId === product.id
                                            ? "Cancelar"
                                            : "Editar"}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={updateProduct.isPending}
                                        onClick={() =>
                                            updateProduct.mutate({
                                                productId: product.id,
                                                active: !product.active,
                                            })
                                        }
                                    >
                                        {product.active
                                            ? "Desactivar"
                                            : "Reactivar"}
                                    </Button>
                                </div>
                                {editingProductId === product.id && (
                                    <div className="mt-4 min-w-64">
                                        {product.reviewNote && (
                                            <p className="mb-3 rounded-md bg-amber-50 p-2 text-amber-900 text-sm">
                                                Motivo del rechazo:{" "}
                                                {product.reviewNote}
                                            </p>
                                        )}
                                        <ProductForm
                                            key={product.id}
                                            defaultValues={{
                                                name: product.name,
                                                description:
                                                    product.description ?? "",
                                                type: product.type,
                                                priceSoles: product.priceSoles,
                                                cogsSoles:
                                                    product.cogsSoles ?? "",
                                            }}
                                            onSubmit={(values) =>
                                                saveProduct(product.id, values)
                                            }
                                            disabled={updateProduct.isPending}
                                            submitLabel="Guardar cambios"
                                        />
                                    </div>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
