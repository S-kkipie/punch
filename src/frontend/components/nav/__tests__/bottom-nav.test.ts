import { describe, expect, it } from "vitest";
import { isBottomNavPathActive } from "../bottom-nav";

describe("isBottomNavPathActive", () => {
    it("matches exact routes and intended subpaths", () => {
        expect(isBottomNavPathActive("/home", "/home")).toBe(true);
        expect(isBottomNavPathActive("/discover/cafe-1", "/discover")).toBe(
            true,
        );
        expect(isBottomNavPathActive("/discovering", "/discover")).toBe(false);
    });

    it("keeps the central scan action active on scan subpaths", () => {
        expect(isBottomNavPathActive("/scan", "/scan")).toBe(true);
        expect(isBottomNavPathActive("/scan/confirm", "/scan")).toBe(true);
    });
});
