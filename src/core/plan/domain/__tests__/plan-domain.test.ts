import { describe, expect, it } from "vitest";
import { backoffMs, classifyPlanError, MAX_PLAN_ATTEMPTS } from "../errors";
import {
    createPlanOrderSchema,
    mpenToSoles,
    PACK_PRICE_MPEN,
    PLAN_PRICE_MPEN,
    PLAN_SPLITS,
    priceForKind,
    RESERVE_PER_CREDIT_MPEN,
} from "../schemas";
import { canTransition, isTerminal } from "../transitions";

describe("plan pricing", () => {
    it("uses the contract prices", () => {
        expect(PLAN_PRICE_MPEN).toBe(49_000_000n);
        expect(PACK_PRICE_MPEN).toBe(40_000_000n);
        expect(priceForKind("plan")).toBe(PLAN_PRICE_MPEN);
        expect(priceForKind("pack")).toBe(PACK_PRICE_MPEN);
    });

    it("splits add up to the price", () => {
        const plan = PLAN_SPLITS.plan;
        expect(plan.reserve + plan.fund + plan.treasury).toBe(PLAN_PRICE_MPEN);
        const pack = PLAN_SPLITS.pack;
        expect(pack.reserve + pack.fund + pack.treasury).toBe(PACK_PRICE_MPEN);
        expect(plan.treasury).toBe(14_000_000n);
        expect(pack.treasury).toBe(5_000_000n);
    });

    it("converts mPEN to soles", () => {
        expect(mpenToSoles(49_000_000n)).toBe(49);
        expect(mpenToSoles(RESERVE_PER_CREDIT_MPEN)).toBe(0.3);
        expect(mpenToSoles(0n)).toBe(0);
    });

    it("rejects an unknown kind at the edge", () => {
        expect(
            createPlanOrderSchema.safeParse({ cafeId: "c1", kind: "plan" })
                .success,
        ).toBe(true);
        expect(
            createPlanOrderSchema.safeParse({ cafeId: "c1", kind: "gift" })
                .success,
        ).toBe(false);
        expect(
            createPlanOrderSchema.safeParse({ cafeId: "", kind: "pack" })
                .success,
        ).toBe(false);
    });
});

describe("plan order transitions", () => {
    it("allows the happy path", () => {
        expect(canTransition("pending", "submitted")).toBe(true);
        expect(canTransition("submitted", "confirmed")).toBe(true);
    });

    it("allows recovering a submitted order back to pending", () => {
        expect(canTransition("submitted", "pending")).toBe(true);
    });

    it("allows pending to confirm directly when a lost receipt reappears", () => {
        expect(canTransition("pending", "confirmed")).toBe(true);
    });

    it("treats confirmed and failed as terminal", () => {
        expect(isTerminal("confirmed")).toBe(true);
        expect(isTerminal("failed")).toBe(true);
        expect(isTerminal("pending")).toBe(false);
        expect(canTransition("confirmed", "pending")).toBe(false);
        expect(canTransition("failed", "submitted")).toBe(false);
    });
});

describe("plan error classification", () => {
    it("marks contract authorization reverts as permanent", () => {
        expect(
            classifyPlanError(new Error("NotAuthorizedForCafe(1, 0xabc)")),
        ).toEqual({
            permanent: true,
            reason: "not_authorized",
        });
        expect(classifyPlanError(new Error("CafeNotOperational(1)"))).toEqual({
            permanent: true,
            reason: "cafe_not_operational",
        });
        expect(classifyPlanError(new Error("PlanNotActive(1)"))).toEqual({
            permanent: true,
            reason: "plan_not_active",
        });
        expect(classifyPlanError(new Error("FaucetCapExceeded(1, 2)"))).toEqual(
            {
                permanent: true,
                reason: "faucet_cap_exceeded",
            },
        );
    });

    it("marks funding unavailability as permanent", () => {
        expect(classifyPlanError(new Error("funding_unavailable"))).toEqual({
            permanent: true,
            reason: "funding_unavailable",
        });
    });

    it("treats rpc and nonce trouble as transient", () => {
        expect(classifyPlanError(new Error("fetch failed"))).toEqual({
            permanent: false,
            reason: null,
        });
        expect(classifyPlanError(new Error("nonce too low"))).toEqual({
            permanent: false,
            reason: null,
        });
    });

    it("backs off exponentially and caps", () => {
        expect(backoffMs(0)).toBe(2_000);
        expect(backoffMs(1)).toBe(4_000);
        expect(backoffMs(3)).toBe(16_000);
        expect(backoffMs(50)).toBe(60_000);
        expect(MAX_PLAN_ATTEMPTS).toBe(5);
    });
});
