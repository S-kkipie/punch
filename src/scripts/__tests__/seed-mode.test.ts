import { describe, expect, it } from "vitest";
import { isDemoSeedEnabled } from "../../../scripts/seed-mode";

describe("seed mode", () => {
    it("disables all fixture work unless explicitly enabled", () => {
        expect(isDemoSeedEnabled({})).toBe(false);
        expect(isDemoSeedEnabled({ NEXT_PUBLIC_DEMO_MODE: "false" })).toBe(
            false,
        );
        expect(isDemoSeedEnabled({ NEXT_PUBLIC_DEMO_MODE: "TRUE" })).toBe(
            false,
        );
    });

    it("preserves canonical demo seeding when explicitly enabled", () => {
        expect(isDemoSeedEnabled({ NEXT_PUBLIC_DEMO_MODE: "true" })).toBe(true);
    });
});
