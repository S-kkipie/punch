"use client";

import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useCafeProducts } from "@/core/cafe/client/hooks";
import type { Product } from "@/core/cafe/domain/types";
import { useCreatePurchaseProof } from "@/core/consumption/client/hooks";
import { CreditsBadge } from "@/core/plan/client/ui/credits-badge";
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
    const [yapeRef, setYapeRef] = useState("");
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const products = (productsQuery.data ?? []) as Product[];
    const emissionProducts = products.filter(
        (product) =>
            product.type === "emission" &&
            product.approvalStatus === "approved" &&
            product.active,
    );
    const proof = ((
        createProof.data as { response?: { deepLink?: string } } | undefined
    )?.response ?? createProof.data) as { deepLink?: string } | undefined;

    useEffect(() => {
        if (!proof?.deepLink || !canvasRef.current) return;
        const deepLink = `${window.location.origin}${proof.deepLink}`;
        void QRCode.toCanvas(canvasRef.current, deepLink);
    }, [proof?.deepLink]);

    const generate = () => {
        if (
            !productId ||
            yapeRef.trim().length < 4 ||
            yapeRef.trim().length > 120
        )
            return;
        createProof.mutate(
            { productId, yapeRef },
            { onSuccess: () => setYapeRef("") },
        );
    };

    return (
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>Generar compra</CardTitle>
                    <CreditsBadge cafeId={cafeId} />
                </CardHeader>
                <CardContent className="space-y-4">
                    {productsQuery.isError ? (
                        <p className="text-destructive text-sm">
                            No se pudo cargar el catálogo.
                        </p>
                    ) : (
                        <Select value={productId} onValueChange={setProductId}>
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
                    <input
                        aria-label="Referencia Yape"
                        className="min-h-11 w-full rounded-md border px-3 text-sm"
                        placeholder="Referencia Yape"
                        maxLength={120}
                        value={yapeRef}
                        onChange={(event) => setYapeRef(event.target.value)}
                    />
                    <Button
                        className="min-h-11 w-full"
                        disabled={
                            !productId ||
                            yapeRef.trim().length < 4 ||
                            yapeRef.trim().length > 120 ||
                            createProof.isPending
                        }
                        onClick={generate}
                    >
                        {createProof.isPending ? "Generando…" : "Generar QR"}
                    </Button>
                </CardContent>
            </Card>
            {proof && (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 p-4">
                        <canvas
                            ref={canvasRef}
                            aria-label="Código QR de compra"
                        />
                        <p className="break-all text-muted-foreground text-xs">
                            {proof.deepLink}
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
