"use client";

import Link from "next/link";
import { usePlanStatus } from "@/core/plan/client/hooks";
import { LOW_CREDITS_THRESHOLD } from "@/core/plan/domain/schemas";
import type { PlanStatusView } from "@/core/plan/domain/types";

export function CreditsBadge({ cafeId }: { cafeId: string }) {
    const { data } = usePlanStatus(cafeId);
    const status = data as PlanStatusView | undefined;
    if (!status) return null;

    if (!status.planActive) {
        return (
            <Link
                href={`/cafe/${cafeId}/plan`}
                className="text-sm text-destructive underline"
            >
                Activa tu plan para poder emitir PUNCH
            </Link>
        );
    }

    const low = status.credits <= LOW_CREDITS_THRESHOLD;
    return (
        <Link href={`/cafe/${cafeId}/plan`} className="text-sm">
            <span className="font-semibold">{status.credits}</span> créditos
            {low ? (
                <span className="ml-2 text-destructive">
                    Te quedan pocos créditos, compra un pack
                </span>
            ) : null}
        </Link>
    );
}
