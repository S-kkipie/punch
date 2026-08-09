"use client";

import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useCafeProducts } from "@/core/cafe/client/hooks";
import type { Product } from "@/core/cafe/domain/types";
import {
    useCreatePurchaseProof,
    usePurchaseProof,
} from "@/core/consumption/client/hooks";
import { Badge } from "@/frontend/components/ui/badge";
import { Button } from "@/frontend/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/frontend/components/ui/select";

export default function CafeTerminalPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const productsQuery = useCafeProducts(cafeId);
    const createProof = useCreatePurchaseProof(cafeId);
    const [productId, setProductId] = useState("");
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const products = (productsQuery.data ?? []) as Product[];
    const emissionProducts = products.filter(
        (product) =>
            product.type === "emission" &&
            product.approvalStatus === "approved" &&
            product.active,
    );
    const proof = ((
        createProof.data as
            | { response?: { id?: string; deepLink?: string } }
            | undefined
    )?.response ?? createProof.data) as
        | { id?: string; deepLink?: string }
        | undefined;
    // Polls so the barista sees the moment the customer's phone confirms —
    // without this the terminal has no way to know the sale went through.
    const proofStatusQuery = usePurchaseProof(proof?.id ?? "");
    const confirmed =
        Boolean(proof?.id) &&
        (proofStatusQuery.data as { status?: string } | undefined)?.status ===
            "confirmed";

    useEffect(() => {
        if (!proof?.deepLink || !canvasRef.current) return;
        const deepLink = `${window.location.origin}${proof.deepLink}`;
        void QRCode.toCanvas(canvasRef.current, deepLink);
    }, [proof?.deepLink]);

    const generate = () => {
        if (!productId) return;
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const receiptHash = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
        createProof.mutate({ productId, receiptHash });
    };

    const nextSale = () => {
        setProductId("");
        createProof.reset();
    };

    return (
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
            {!proof && (
                <Card>
                    <CardHeader>
                        <CardTitle>Generar compra</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {productsQuery.isError ? (
                            <p className="text-destructive text-sm">
                                No se pudo cargar el catálogo.
                            </p>
                        ) : (
                            <Select
                                value={productId}
                                onValueChange={setProductId}
                            >
                                <SelectTrigger aria-label="Producto de emisión">
                                    <SelectValue placeholder="Elige un producto de emisión" />
                                </SelectTrigger>
                                <SelectContent>
                                    {emissionProducts.map((product) => (
                                        <SelectItem
                                            key={product.id}
                                            value={product.id}
                                        >
                                            {product.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <Button
                            className="min-h-11 w-full"
                            disabled={!productId || createProof.isPending}
                            onClick={generate}
                        >
                            {createProof.isPending
                                ? "Generando…"
                                : "Generar QR"}
                        </Button>
                    </CardContent>
                </Card>
            )}
            {proof && (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 p-4">
                        <Badge variant={confirmed ? "default" : "outline"}>
                            {confirmed
                                ? "Compra confirmada"
                                : "Esperando que el cliente escanee y confirme…"}
                        </Badge>
                        <canvas
                            ref={canvasRef}
                            aria-label="Código QR de compra"
                        />
                        <p className="break-all text-muted-foreground text-xs">
                            {proof.deepLink}
                        </p>
                        <Button className="min-h-11 w-full" onClick={nextSale}>
                            {confirmed
                                ? "Siguiente venta"
                                : "Cancelar y generar otro código"}
                        </Button>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
