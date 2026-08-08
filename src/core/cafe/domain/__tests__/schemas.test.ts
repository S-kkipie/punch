import { describe, expect, it } from "vitest";
import { createCafeSchema, createProductSchema } from "../schemas";
import { canTransition, submissionGaps } from "../transitions";

describe("createProductSchema", () => {
    const base = {
        name: "Latte",
        priceSoles: "10.50",
        type: "emission" as const,
    };

    it("accepts a valid emission product", () => {
        expect(createProductSchema.safeParse(base).success).toBe(true);
    });

    it("rejects reward with price above S/12", () => {
        const r = createProductSchema.safeParse({
            ...base,
            type: "reward",
            priceSoles: "12.50",
            cogsSoles: "3.00",
        });
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(JSON.stringify(r.error.issues)).toContain(
                "Un producto reward no puede superar S/12",
            );
        }
    });

    it("accepts reward at exactly S/12", () => {
        const r = createProductSchema.safeParse({
            ...base,
            type: "reward",
            priceSoles: "12",
            cogsSoles: "2.80",
        });
        expect(r.success).toBe(true);
    });

    it("rejects reward without cogs", () => {
        const r = createProductSchema.safeParse({
            ...base,
            type: "reward",
            priceSoles: "10",
        });
        expect(r.success).toBe(false);
    });

    it("rejects non-positive price", () => {
        expect(
            createProductSchema.safeParse({ ...base, priceSoles: "0" }).success,
        ).toBe(false);
    });
});

describe("createCafeSchema", () => {
    it("requires a name", () => {
        expect(createCafeSchema.safeParse({ name: " " }).success).toBe(false);
        expect(createCafeSchema.safeParse({ name: "Brújula" }).success).toBe(
            true,
        );
    });
});

describe("canTransition", () => {
    it.each([
        ["draft", "submitted", true],
        ["submitted", "approved", true],
        ["submitted", "rejected", true],
        ["rejected", "submitted", true],
        ["draft", "approved", false],
        ["approved", "rejected", false],
        ["approved", "submitted", false],
        ["rejected", "approved", false],
    ] as const)("%s → %s = %s", (from, to, allowed) => {
        expect(canTransition(from, to)).toBe(allowed);
    });
});

describe("submissionGaps", () => {
    const full = {
        id: "c1",
        name: "Brújula",
        slug: "brujula",
        description: null,
        address: "Av. Larco 123",
        district: "Miraflores",
        lat: null,
        lng: null,
        photoUrl: null,
        ruc: "20123456789",
        contactPhone: "+51 999 999 999",
        onboardingStatus: "draft" as const,
        reviewNote: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };

    it("empty gaps when complete with one emission product", () => {
        expect(submissionGaps(full, 1)).toEqual([]);
    });

    it("lists each missing field and missing emission product", () => {
        const gaps = submissionGaps(
            { ...full, address: null, contactPhone: null },
            0,
        );
        expect(gaps).toContain("address");
        expect(gaps).toContain("contactPhone");
        expect(gaps).toContain("emissionProduct");
    });
});
