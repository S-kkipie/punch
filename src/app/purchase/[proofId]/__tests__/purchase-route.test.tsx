import { describe, expect, it, vi } from "vitest";

const { authenticate, redirect } = vi.hoisted(() => ({
    authenticate: vi.fn(),
    redirect: vi.fn(),
}));
vi.mock("@/server/auth/auth", () => ({ authenticate }));
vi.mock("next/navigation", () => ({ redirect }));

import PurchaseRoutePage from "../page";

describe("public purchase route", () => {
    it("preserves the quote destination through sign-in when unauthenticated", async () => {
        authenticate.mockResolvedValue(null);
        await PurchaseRoutePage({
            params: Promise.resolve({ proofId: "quote-123" }),
        });
        expect(redirect).toHaveBeenCalledWith(
            "/auth/sign-in?redirect=%2Fpurchase%2Fquote-123",
        );
    });
});
