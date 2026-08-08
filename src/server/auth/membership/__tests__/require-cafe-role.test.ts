import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repository", () => ({ findMembership: vi.fn() }));

import type { CafeMemberRow } from "@/server/drizzle/schemas/cafe-schema";
import { findMembership } from "../repository";
import { requireCafeRole, requireOps } from "../require-cafe-role";

const membership: CafeMemberRow = {
    id: "m1",
    userId: "u1",
    cafeId: "c1",
    role: "owner",
    createdAt: new Date(),
};

describe("requireCafeRole", () => {
    beforeEach(() => vi.clearAllMocks());

    it("allows a matching role", async () => {
        vi.mocked(findMembership).mockResolvedValue(membership);
        const r = await requireCafeRole("u1", "c1", ["owner"]);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.role).toBe("owner");
    });

    it("forbids when no membership", async () => {
        vi.mocked(findMembership).mockResolvedValue(null);
        const r = await requireCafeRole("u1", "c1", ["owner"]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    });

    it("forbids when role not in allowed set", async () => {
        vi.mocked(findMembership).mockResolvedValue({
            ...membership,
            role: "barista",
        });
        const r = await requireCafeRole("u1", "c1", ["owner"]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(403);
    });

    it("barista allowed when barista is in the set", async () => {
        vi.mocked(findMembership).mockResolvedValue({
            ...membership,
            role: "barista",
        });
        const r = await requireCafeRole("u1", "c1", ["owner", "barista"]);
        expect(r.ok).toBe(true);
    });
});

describe("requireOps", () => {
    it("allows ops user", () => {
        expect(requireOps({ isOps: true }).ok).toBe(true);
    });
    it("forbids non-ops and missing flag", () => {
        expect(requireOps({ isOps: false }).ok).toBe(false);
        expect(requireOps({}).ok).toBe(false);
    });
});
