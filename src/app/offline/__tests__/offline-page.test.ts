import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public offline route", () => {
    it("lives outside the authenticated app layout", () => {
        const source = readFileSync(
            new URL("../page.tsx", import.meta.url),
            "utf8",
        );
        expect(source).not.toContain("requireAuth");
        expect(source).toContain("Estás sin conexión");
    });
});
