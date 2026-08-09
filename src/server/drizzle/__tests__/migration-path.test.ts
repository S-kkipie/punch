import { describe, expect, it } from "vitest";
import { drizzleRoot } from "../migration-path";

describe("migration path", () => {
    it("resolves from the test module location", () => {
        expect(drizzleRoot).toMatch(/drizzle$/);
    });
});
