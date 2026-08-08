import { describe, expect, it } from "vitest";
import { postAuthDestination } from "../page";

describe("post-auth destination", () => {
    it("keeps a consumer on home", () => {
        expect(postAuthDestination([])).toBe("/home");
    });
    it("sends an approved owner or barista to the terminal", () => {
        expect(
            postAuthDestination([
                { id: "cafe-1", onboardingStatus: "approved" },
            ]),
        ).toBe("/cafe/cafe-1/terminal");
        expect(
            postAuthDestination([
                { id: "cafe-2", onboardingStatus: "submitted" },
            ]),
        ).toBe("/cafe/cafe-2");
    });
});
