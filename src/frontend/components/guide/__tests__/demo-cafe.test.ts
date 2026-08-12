import { describe, expect, it } from "vitest";

import { DEMO_CAFE_SLUG, demoCafeFirst, isDemoCafe } from "../demo-cafe";

describe("demo-cafe", () => {
    it("recognises only the seeded demo cafe", () => {
        expect(isDemoCafe({ slug: DEMO_CAFE_SLUG })).toBe(true);
        expect(isDemoCafe({ slug: "otra-cafeteria" })).toBe(false);
        expect(isDemoCafe({})).toBe(false);
    });

    it("puts the demo cafe first and keeps the rest in order", () => {
        const cafes = [
            { slug: "uno" },
            { slug: "dos" },
            { slug: DEMO_CAFE_SLUG },
            { slug: "tres" },
        ];

        expect(demoCafeFirst(cafes).map((cafe) => cafe.slug)).toEqual([
            DEMO_CAFE_SLUG,
            "uno",
            "dos",
            "tres",
        ]);
    });

    it("does not mutate the input", () => {
        const cafes = [{ slug: "uno" }, { slug: DEMO_CAFE_SLUG }];
        demoCafeFirst(cafes);
        expect(cafes[0].slug).toBe("uno");
    });
});
