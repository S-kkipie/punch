import { z } from "zod";
import type { PlanOrderKind } from "./types";

export const PLAN_PRICE_MPEN = 49_000_000n;
export const PACK_PRICE_MPEN = 40_000_000n;
export const CREDITS_PER_PURCHASE = 100;
export const RESERVE_PER_CREDIT_MPEN = 300_000n;
export const LOW_CREDITS_THRESHOLD = 10;

/** Mirrors PlanManager's constants. Reserve is the remainder the contract keeps. */
export const PLAN_SPLITS = {
    plan: { reserve: 30_000_000n, fund: 5_000_000n, treasury: 14_000_000n },
    pack: { reserve: 30_000_000n, fund: 5_000_000n, treasury: 5_000_000n },
} as const;

export const planOrderKindValues = ["plan", "pack"] as const;
export const planOrderStatusValues = [
    "pending",
    "submitted",
    "confirmed",
    "failed",
] as const;

export const planOrderKindSchema = z.enum(planOrderKindValues);
export const planOrderStatusSchema = z.enum(planOrderStatusValues);

export function priceForKind(kind: PlanOrderKind): bigint {
    return kind === "plan" ? PLAN_PRICE_MPEN : PACK_PRICE_MPEN;
}

export function mpenToSoles(value: bigint): number {
    return Number(value) / 1_000_000;
}

export const createPlanOrderSchema = z.object({
    cafeId: z.string().min(1),
    kind: planOrderKindSchema,
});

export const planOrderSchema = z.object({
    id: z.string(),
    cafeId: z.string(),
    kind: planOrderKindSchema,
    priceSoles: z.number().positive(),
    status: planOrderStatusSchema,
    failureReason: z.string().nullable(),
    txHash: z.string().nullable(),
    createdAt: z.iso.datetime(),
});

export const planStatusSchema = z.object({
    cafeId: z.string(),
    planActive: z.boolean(),
    credits: z.number().int().nonnegative(),
    unallocatedReserveSoles: z.number().nonnegative(),
    canPay: z.boolean(),
    inFlightOrderId: z.string().nullable(),
    needsReconciliation: z.boolean(),
});
