import { describe, expect, it } from "vitest";
import { LANDING_COPY, LANDING_LINKS } from "../landing-content";

const flattenStrings = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(flattenStrings);
    if (value && typeof value === "object") {
        return Object.values(value).flatMap(flattenStrings);
    }
    return [];
};

describe("landing content contract", () => {
    const copy = flattenStrings(LANDING_COPY).join(" ");

    it("leads with the approved coalition thesis", () => {
        expect(LANDING_COPY.hero.title).toBe(
            "No necesitas parecer cadena. Necesitas mover clientes como una.",
        );
        expect(LANDING_COPY.hero.body).toContain(
            "Cada local conserva su identidad",
        );
    });

    it("keeps the café path primary", () => {
        expect(LANDING_LINKS.cafe).toBe("/auth/sign-up?rol=cafe");
        expect(LANDING_LINKS.consumer).toBe("/auth/sign-up");
        expect(LANDING_COPY.hero.primaryCta).toBe("Quiero sumar mi café");
    });

    it("uses Lima and identifies changing operating rules", () => {
        expect(LANDING_COPY.footer.market).toContain("Lima, Perú");
        expect(LANDING_COPY.footer.conditions).toContain("pueden variar");
    });

    it.each([
        "1 punto",
        "S/0.01",
        "1,200",
        "S/12 completos",
        "10–15 %",
        "gratis para siempre",
        "Arequipa",
    ])("excludes discarded claim %s", (claim) => {
        expect(copy).not.toContain(claim);
    });
});
