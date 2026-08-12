"use client";

import { useParams } from "next/navigation";
import {
    useCreatePlanOrder,
    usePlanOrders,
    usePlanStatus,
} from "@/core/plan/client/hooks";
import { PlanCard } from "@/core/plan/client/ui/plan-card";
import { PlanHistory } from "@/core/plan/client/ui/plan-history";
import {
    CREDITS_PER_PURCHASE,
    mpenToSoles,
    PLAN_PRICE_MPEN,
} from "@/core/plan/domain/schemas";
import type {
    PlanOrderKind,
    PlanOrderView,
    PlanStatusView,
} from "@/core/plan/domain/types";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Stat } from "@/frontend/components/guide/stat";
import { Spinner } from "@/frontend/components/ui/spinner";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const creditsGrantedByOrder = (order: Pick<PlanOrderView, "kind">) =>
    order.kind === "plan" || order.kind === "pack" ? CREDITS_PER_PURCHASE : 0;

export function calculateWeeksAtCurrentPace(
    credits: number,
    orders: Pick<PlanOrderView, "createdAt" | "kind" | "status">[],
): number | null {
    const confirmedOrders = [...orders]
        .filter((order) => order.status === "confirmed")
        .map((order) => ({
            at: new Date(order.createdAt).getTime(),
            credits: creditsGrantedByOrder(order),
        }))
        .filter((point) => Number.isFinite(point.at))
        .sort((a, b) => a.at - b.at);

    if (confirmedOrders.length < 2) return null;

    const first = confirmedOrders[0];
    const last = confirmedOrders[confirmedOrders.length - 1];

    const weeks = (last.at - first.at) / MS_PER_WEEK;
    if (weeks <= 0 || Number.isNaN(weeks)) return null;

    const totalGranted = confirmedOrders.reduce(
        (sum, point) => sum + point.credits,
        0,
    );
    const burned = totalGranted - credits;

    if (burned <= 0) return null;

    const weeklyBurn = burned / weeks;
    if (weeklyBurn <= 0 || Number.isNaN(weeklyBurn)) return null;

    const remainingWeeks = credits / weeklyBurn;
    if (remainingWeeks <= 0 || Number.isNaN(remainingWeeks)) return null;

    return Math.round(remainingWeeks);
}

export default function PlanPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const statusQuery = usePlanStatus(cafeId);
    const ordersQuery = usePlanOrders(cafeId);
    const createOrder = useCreatePlanOrder(cafeId);

    const status = statusQuery.data as PlanStatusView | undefined;
    const orders = (ordersQuery.data ?? []) as PlanOrderView[];

    if (!status) return <Spinner />;

    const remainingWeeks = calculateWeeksAtCurrentPace(status.credits, orders);
    const pay = (kind: PlanOrderKind) =>
        createOrder.mutate({ cafeId, kind } as never);

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
            <PageIntro
                eyebrow="Lo que pagas"
                title="Plan del café"
                explain="Cada sello que emites consume un crédito. Sin créditos,
                la terminal deja de generar códigos."
            />

            <div className="guide-stat-row">
                <Stat
                    label="Créditos"
                    value={String(status.credits)}
                    hint={
                        remainingWeeks === null
                            ? undefined
                            : `≈ ${remainingWeeks} semanas a tu ritmo actual`
                    }
                    lead
                />
                <Stat
                    label="Plan"
                    value="Barrio"
                    hint={
                        status.planActive
                            ? `S/${mpenToSoles(PLAN_PRICE_MPEN)} al mes`
                            : "Activa para recargar"
                    }
                />
            </div>

            <PlanCard
                status={status}
                onPay={pay}
                isPending={createOrder.isPending}
            />
            <PlanHistory orders={orders} />
        </div>
    );
}
