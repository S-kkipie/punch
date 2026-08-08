import type { Product } from "@/core/cafe/domain/types";
import { Badge } from "@/frontend/components/ui/badge";
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

export function ProductList({ products }: { products: Product[] }) {
    if (products.length === 0) {
        return (
            <p className="text-muted-foreground text-sm">
                Aún no tienes productos.
            </p>
        );
    }
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
                                {product.reviewNote && (
                                    <p className="mt-1 text-muted-foreground text-xs">
                                        {product.reviewNote}
                                    </p>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
