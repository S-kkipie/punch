"use client";

import { useParams } from "next/navigation";
import {
    useCreatePlanOrder,
    usePlanOrders,
    usePlanStatus,
} from "@/core/plan/client/hooks";
import { PlanCard } from "@/core/plan/client/ui/plan-card";
import { PlanHistory } from "@/core/plan/client/ui/plan-history";
import type {
    PlanOrderKind,
    PlanOrderView,
    PlanStatusView,
} from "@/core/plan/domain/types";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function PlanPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const statusQuery = usePlanStatus(cafeId);
    const ordersQuery = usePlanOrders(cafeId);
    const createOrder = useCreatePlanOrder(cafeId);

    const status = statusQuery.data as PlanStatusView | undefined;
    const orders = (ordersQuery.data ?? []) as PlanOrderView[];

    if (!status) return <Spinner />;

    const pay = (kind: PlanOrderKind) =>
        createOrder.mutate({ cafeId, kind } as never);

    return (
        <div className="space-y-6 p-4">
            <h1 className="text-2xl font-semibold">Plan del café</h1>
            <PlanCard
                status={status}
                onPay={pay}
                isPending={createOrder.isPending}
            />
            <PlanHistory orders={orders} />
        </div>
    );
}
