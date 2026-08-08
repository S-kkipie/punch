"use client";

import { useState } from "react";
import { useReviewCafe, useReviewProduct } from "@/core/cafe/client/hooks";
import type { CafeAdmin, Product } from "@/core/cafe/domain/types";
import { Button } from "@/frontend/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";
import { Textarea } from "@/frontend/components/ui/textarea";

type ReviewCardProps =
    | { kind: "cafe"; item: CafeAdmin }
    | { kind: "product"; item: Product };

export function ReviewCard({ kind, item }: ReviewCardProps) {
    const [reviewNote, setReviewNote] = useState("");
    const reviewCafe = useReviewCafe(kind === "cafe" ? item.id : "");
    const reviewProduct = useReviewProduct();
    const mutation = kind === "cafe" ? reviewCafe : reviewProduct;
    const isPending = mutation.isPending;
    const noteReady = reviewNote.trim().length > 0;

    const review = (decision: "approved" | "rejected") => {
        const body = { decision, ...(noteReady ? { reviewNote } : {}) };
        if (kind === "cafe") {
            reviewCafe.mutate(body);
        } else {
            reviewProduct.mutate({ productId: item.id, ...body });
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{item.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {kind === "cafe" ? (
                    <div className="space-y-1 text-sm">
                        <p>{item.description || "Sin descripción"}</p>
                        <p className="text-muted-foreground">
                            {item.address || "Dirección pendiente"} ·{" "}
                            {item.district || "Distrito pendiente"}
                        </p>
                        <p className="text-muted-foreground">
                            Contacto: {item.contactPhone || "No registrado"}
                        </p>
                        <p className="text-muted-foreground">
                            RUC: {item.ruc || "No registrado"}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                            <p className="text-muted-foreground">Tipo</p>
                            <p>
                                {item.type === "reward"
                                    ? "Recompensa"
                                    : "Emisión"}
                            </p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">Precio</p>
                            <p>S/ {item.priceSoles}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">COGS</p>
                            <p>
                                {item.cogsSoles ? `S/ ${item.cogsSoles}` : "—"}
                            </p>
                        </div>
                    </div>
                )}
                <Textarea
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder="Nota de revisión (obligatoria para rechazar)"
                    aria-label={`Nota de revisión para ${item.name}`}
                />
                <div className="flex flex-wrap gap-2">
                    <Button
                        disabled={isPending}
                        onClick={() => review("approved")}
                    >
                        Aprobar
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={isPending || !noteReady}
                        onClick={() => review("rejected")}
                    >
                        Rechazar
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
