"use client";

import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCafeProducts } from "@/core/cafe/client/hooks";
import type { Product } from "@/core/cafe/domain/types";
import { useCreatePurchaseProof } from "@/core/consumption/client/hooks";
import { ChainReceipt } from "@/frontend/components/guide/chain-receipt";
import { FirstTimeHere } from "@/frontend/components/guide/first-time-here";
import { JourneyCard } from "@/frontend/components/guide/journey-card";
import { PageIntro } from "@/frontend/components/guide/page-intro";
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

type TerminalProof = {
    deepLink?: string;
    txHash?: string | null;
    blockNumber?: number | null;
    failureReason?: string | null;
    state?: "queued" | "submitted" | "confirmed" | "failed";
};

const getProof = (response: unknown): TerminalProof | null => {
    const raw = (response ?? null) as
        | null
        | (TerminalProof & { response?: TerminalProof });

    if (!raw) return null;

    const data = raw.response ?? raw;
    if (!data || typeof data !== "object") return null;

    return {
        deepLink: data.deepLink,
        txHash: data.txHash,
        blockNumber: data.blockNumber,
        failureReason: data.failureReason,
        state: data.state,
    };
};

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

    const proof = getProof(createProof.data);
    const proofUrl = proof?.deepLink
        ? `${window.location.origin}${proof.deepLink}`
        : null;

    const selectedProduct = useMemo(
        () => emissionProducts.find((product) => product.id === productId),
        [emissionProducts, productId],
    );
    const selectedProductName =
        selectedProduct?.name ?? "Producto no seleccionado";
    const selectedProductPrice =
        selectedProduct === undefined
            ? null
            : `S/ ${Number(selectedProduct.priceSoles).toFixed(2)}`;

    const isGenerateDisabled =
        !productId ||
        yapeRef.trim().length < 4 ||
        yapeRef.trim().length > 120 ||
        createProof.isPending;

    const chainReceiptState = proof?.txHash
        ? (proof.state ?? (proof.blockNumber ? "confirmed" : "submitted"))
        : null;

    useEffect(() => {
        if (!proofUrl || !canvasRef.current) return;
        void QRCode.toCanvas(canvasRef.current, proofUrl);
    }, [proofUrl]);

    const generate = () => {
        if (isGenerateDisabled) return;
        createProof.mutate(
            { productId, yapeRef },
            { onSuccess: () => setYapeRef("") },
        );
    };

    return (
        <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
            <FirstTimeHere />
            <PageIntro
                eyebrow="Mostrador"
                title="Cobrar una compra"
                explain="Cobras por Yape como siempre. Aquí solo generas el código que el cliente escanea para llevarse su sello."
            />

            <section
                aria-label="Flujo de cobro"
                className="grid gap-4 md:grid-cols-2"
            >
                <div className="grid gap-4">
                    <section className="consumer-panel grid gap-3 p-5">
                        <span
                            className="mono xs"
                            style={{ color: "var(--color-accent)" }}
                        >
                            PASO 1
                        </span>
                        <p className="text-sm font-semibold">Producto</p>
                        {productsQuery.isError ? (
                            <p className="text-destructive text-sm">
                                No se pudo cargar el catálogo.
                            </p>
                        ) : (
                            <Select
                                value={productId}
                                onValueChange={setProductId}
                            >
                                <SelectTrigger
                                    aria-label="Producto de emisión"
                                    className="w-full"
                                >
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
                    </section>

                    <section className="consumer-panel grid gap-3 p-5">
                        <span
                            className="mono xs"
                            style={{ color: "var(--color-accent)" }}
                        >
                            PASO 2
                        </span>
                        <label
                            className="text-sm font-semibold"
                            htmlFor="yape-reference"
                        >
                            Referencia Yape
                        </label>
                        <input
                            id="yape-reference"
                            aria-label="Referencia Yape"
                            className="min-h-11 w-full rounded-md border px-3 text-sm"
                            placeholder="0087-4412"
                            maxLength={120}
                            value={yapeRef}
                            onChange={(event) => setYapeRef(event.target.value)}
                        />
                        <p className="text-muted-foreground text-xs">
                            Los últimos dígitos que ves en tu app de Yape.
                        </p>
                        <Button
                            className="min-h-11 w-full"
                            disabled={isGenerateDisabled}
                            onClick={generate}
                        >
                            {createProof.isPending
                                ? "Generando…"
                                : "Generar código"}
                        </Button>
                    </section>
                </div>

                <section className="consumer-panel grid gap-3 p-5 text-center">
                    <span
                        className="mono xs"
                        style={{ color: "var(--color-accent)" }}
                    >
                        PASO 3
                    </span>
                    <p className="font-semibold">Muéstralo al cliente</p>
                    {proof ? (
                        <Card>
                            <CardHeader>
                                <CardTitle>
                                    {selectedProductName}
                                    {selectedProductPrice
                                        ? ` · ${selectedProductPrice}`
                                        : ""}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="grid gap-3">
                                <canvas
                                    ref={canvasRef}
                                    aria-label="Código QR de compra"
                                />
                                <p className="break-all text-muted-foreground text-xs">
                                    {proof.deepLink}
                                </p>
                                {chainReceiptState ? (
                                    <ChainReceipt
                                        state={chainReceiptState}
                                        txHash={proof.txHash ?? undefined}
                                        blockNumber={
                                            proof.blockNumber ?? undefined
                                        }
                                        failureReason={
                                            proof.failureReason ?? undefined
                                        }
                                    />
                                ) : null}
                            </CardContent>
                        </Card>
                    ) : (
                        <p className="text-sm text-[var(--color-ink-2)]">
                            Genera el código para mostrarle el QR al cliente.
                        </p>
                    )}
                </section>
            </section>

            <p className="text-xs text-muted-foreground">
                Los últimos dígitos de Yape te sirven para conciliar después.
            </p>
            <JourneyCard currentRole="cafeteria" />
        </div>
    );
}
