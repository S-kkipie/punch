import { describe, expect, it } from "vitest";

import { postAuthDestination } from "../page";

describe("post-auth destination", () => {
    it("keeps a consumer on home", () => {
        expect(postAuthDestination([])).toBe("/home");
    });
    it("prefers an approved café regardless of membership order", () => {
        const memberships = [
            { id: "cafe-z", onboardingStatus: "submitted" },
            { id: "cafe-a", onboardingStatus: "approved" },
        ];
        expect(postAuthDestination(memberships)).toBe("/cafe/cafe-a/terminal");
        expect(postAuthDestination([...memberships].reverse())).toBe(
            "/cafe/cafe-a/terminal",
        );
    });

    it("breaks same-status ties by café ID", () => {
        expect(
            postAuthDestination([
                { id: "cafe-z", onboardingStatus: "submitted" },
                { id: "cafe-a", onboardingStatus: "submitted" },
            ]),
        ).toBe("/cafe/cafe-a");
    });

    it("routes an approved owner or barista membership to the terminal", () => {
        expect(
            postAuthDestination([
                { id: "cafe-1", onboardingStatus: "approved" },
            ]),
        ).toBe("/cafe/cafe-1/terminal");
    });

    it("routes a non-approved membership to the café panel", () => {
        expect(
            postAuthDestination([
                { id: "cafe-2", onboardingStatus: "submitted" },
            ]),
        ).toBe("/cafe/cafe-2");
    });
});
