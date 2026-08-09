"use client";

import { PLAN_SPLITS } from "@/core/plan/domain/schemas";
import type { PlanOrderKind, PlanStatusView } from "@/core/plan/domain/types";
import { Button } from "@/frontend/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";

const soles = (value: number) =>
    value.toLocaleString("es-PE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

function SplitRow({ label, amount }: { label: string; amount: bigint }) {
    return (
        <div className="flex justify-between text-sm">
            <span>{label}</span>
            <span>S/{soles(Number(amount) / 1_000_000)}</span>
        </div>
    );
}

export function PlanCard({
    status,
    onPay,
    isPending,
}: {
    status: PlanStatusView;
    onPay: (kind: PlanOrderKind) => void;
    isPending: boolean;
}) {
    const kind: PlanOrderKind = status.planActive ? "pack" : "plan";
    const split = PLAN_SPLITS[kind];
    const price = kind === "plan" ? 49 : 40;
    const label = kind === "plan" ? "Activar plan" : "Comprar pack";
    const blocked = status.inFlightOrderId !== null || isPending;

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    {status.planActive ? "Plan activo" : "Plan inactivo"}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-8">
                    <div>
                        <p className="text-sm text-muted-foreground">
                            Créditos disponibles
                        </p>
                        <p className="text-3xl font-semibold">
                            {status.credits}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm text-muted-foreground">
                            Reserva no asignada
                        </p>
                        <p className="text-3xl font-semibold">
                            S/{soles(status.unallocatedReserveSoles)}
                        </p>
                    </div>
                </div>

                <p className="text-sm text-muted-foreground">
                    Tus créditos no vencen. Los que no emitas siguen
                    disponibles, y con ellos su reserva de S/0.30 por crédito.
                </p>

                <div className="space-y-1 rounded-md border p-3">
                    <p className="text-sm font-medium">
                        {label} · S/{price}
                    </p>
                    <SplitRow
                        label="Reserva de rewards"
                        amount={split.reserve}
                    />
                    <SplitRow label="Fondo común" amount={split.fund} />
                    <SplitRow label="Tesorería PUNCH" amount={split.treasury} />
                    <p className="text-sm text-muted-foreground">
                        +100 créditos
                    </p>
                </div>

                {status.canPay ? (
                    <Button
                        aria-label={`${label} · S/${price}`}
                        disabled={blocked}
                        onClick={() => onPay(kind)}
                    >
                        {status.inFlightOrderId
                            ? "Procesando pago…"
                            : `${label} · S/${price}`}
                    </Button>
                ) : (
                    <p className="text-sm text-destructive">
                        Tu cuenta no está autorizada en la cadena para pagar por
                        este café. Pídele al dueño que te autorice como
                        operador.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
