import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/server/auth/auth")>();
    return {
        ...actual,
        auth: {
            ...actual.auth,
            api: { ...actual.auth.api, getSession: vi.fn() },
        },
    };
});
vi.mock("../../services/get-purchase-quote-service", () => ({
    getPurchaseQuoteService: vi.fn(),
}));

import { auth } from "@/server/auth/auth";
import { err } from "@/server/common/responses";
import app from "@/server/router";
import { getPurchaseQuoteService } from "../../services/get-purchase-quote-service";

const session = { user: { id: "user-1" }, session: { id: "session-1" } };

async function request(path: string, init?: RequestInit) {
    return app.handle(new Request(`http://localhost${path}`, init));
}

describe("consumption purchase proof route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auth.api.getSession).mockResolvedValue(null);
    });

    it("maps forbidden quote reads to 403", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
        vi.mocked(getPurchaseQuoteService).mockResolvedValue(
            err({ type: "ForbiddenError", code: "FORBIDDEN", status: 403 }),
        );

        const response = await request(
            "/api/v1/consumption/purchase-proofs/quote-1",
        );

        expect(response.status).toBe(403);
    });
});
