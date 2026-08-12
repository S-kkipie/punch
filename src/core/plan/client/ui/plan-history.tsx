"use client";

import type { PlanOrderView } from "@/core/plan/domain/types";
import { TxHashLink } from "@/frontend/components/tx-hash-link";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";

const statusLabel: Record<PlanOrderView["status"], string> = {
    pending: "En proceso",
    submitted: "Enviado",
    confirmed: "Confirmado",
    failed: "Falló",
};

function orderDetail(order: PlanOrderView) {
    if (order.txHash) return <TxHashLink txHash={order.txHash} />;
    if (order.failureReason === "needs_reconciliation") {
        return "Requiere revisión de PUNCH";
    }
    return order.failureReason ?? "";
}

export function PlanHistory({ orders }: { orders: PlanOrderView[] }) {
    if (orders.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Historial de pagos</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        Todavía no hay pagos registrados.
                    </p>
                </CardContent>
            </Card>
        );
    }
    return (
        <Card>
            <CardHeader>
                <CardTitle>Historial de pagos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {orders.map((order) => (
                    <div
                        key={order.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0"
                    >
                        <span>{order.kind === "plan" ? "Plan" : "Pack"}</span>
                        <span>S/{order.priceSoles.toFixed(2)}</span>
                        <span>
                            {new Date(order.createdAt).toLocaleDateString(
                                "es-PE",
                            )}
                        </span>
                        <span>
                            {order.failureReason === "needs_reconciliation"
                                ? "Requiere revisión"
                                : statusLabel[order.status]}
                        </span>
                        <span className="font-mono text-xs">
                            {orderDetail(order)}
                        </span>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
