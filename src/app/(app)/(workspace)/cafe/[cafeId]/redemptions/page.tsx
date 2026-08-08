"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import {
    useCafeRedemptionInbox,
    useDecidePunchRedemption,
    useDecideVoucherRedemption,
} from "@/core/consumption/client/hooks";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent } from "@/frontend/components/ui/card";
import { Input } from "@/frontend/components/ui/input";
import { Spinner } from "@/frontend/components/ui/spinner";

type Request = { id: string; kind: "punch_reward" | "voucher"; status: string };

export default function CafeRedemptionsPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const inboxQuery = useCafeRedemptionInbox(cafeId);
    const decidePunch = useDecidePunchRedemption(cafeId);
    const decideVoucher = useDecideVoucherRedemption(cafeId);
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const [message, setMessage] = useState("");

    if (inboxQuery.isPending) {
        return (
            <div
                className="flex justify-center p-12"
                role="status"
                aria-label="Cargando solicitudes"
            >
                <Spinner />
            </div>
        );
    }
    if (inboxQuery.isError) {
        return (
            <p className="p-6 text-destructive">
                No se pudo cargar la bandeja de canjes.
            </p>
        );
    }

    const requests = (inboxQuery.data ?? []) as Request[];
    const decide = (request: Request, decision: "approved" | "rejected") => {
        const mutation =
            request.kind === "punch_reward" ? decidePunch : decideVoucher;
        mutation.mutate(
            {
                requestId: request.id,
                decision,
                rejectionReason:
                    decision === "rejected" ? reasons[request.id] : undefined,
            },
            {
                onSuccess: () => setMessage("Solicitud actualizada."),
                onError: () =>
                    setMessage("No se pudo actualizar la solicitud."),
            },
        );
    };

    return (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            <h1 className="font-semibold text-2xl">Bandeja de canjes</h1>
            <p className="sr-only" role="status" aria-live="polite">
                {message}
            </p>
            {requests.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-muted-foreground">
                        No hay solicitudes pendientes.
                    </CardContent>
                </Card>
            ) : (
                requests.map((request) => {
                    const pending =
                        decidePunch.isPending || decideVoucher.isPending;
                    return (
                        <Card key={request.id}>
                            <CardContent className="space-y-3 p-4">
                                <p className="font-medium">
                                    {request.kind === "punch_reward"
                                        ? "Canje de PUNCH"
                                        : "Uso de voucher"}
                                </p>
                                <Input
                                    aria-label="Motivo del rechazo"
                                    placeholder="Motivo si rechazas"
                                    value={reasons[request.id] ?? ""}
                                    onChange={(event) =>
                                        setReasons((current) => ({
                                            ...current,
                                            [request.id]: event.target.value,
                                        }))
                                    }
                                />
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        className="min-h-11"
                                        disabled={pending}
                                        onClick={() =>
                                            decide(request, "approved")
                                        }
                                    >
                                        Aprobar
                                    </Button>
                                    <Button
                                        className="min-h-11"
                                        variant="outline"
                                        disabled={
                                            !reasons[request.id]?.trim() ||
                                            pending
                                        }
                                        onClick={() =>
                                            decide(request, "rejected")
                                        }
                                    >
                                        Rechazar
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })
            )}
        </div>
    );
}
