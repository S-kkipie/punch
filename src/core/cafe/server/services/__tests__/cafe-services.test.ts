import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/create-cafe", () => ({ createCafe: vi.fn() }));
vi.mock("../../repository/find-cafe-by-id", () => ({ findCafeById: vi.fn() }));
vi.mock("../../repository/list-approved-cafes", () => ({
    listApprovedCafes: vi.fn(),
}));
vi.mock("../../repository/list-cafes-by-status", () => ({
    listCafesByStatus: vi.fn(),
}));
vi.mock("../../repository/update-cafe", () => ({ updateCafe: vi.fn() }));
vi.mock("../../repository/count-emission-products", () => ({
    countEmissionProducts: vi.fn(),
}));
vi.mock("../../repository/add-member", () => ({ addMember: vi.fn() }));
vi.mock(
    "@/server/auth/membership/require-cafe-role",
    async (importOriginal) => {
        const actual =
            await importOriginal<
                typeof import("@/server/auth/membership/require-cafe-role")
            >();
        return { ...actual, requireCafeRole: vi.fn() };
    },
);

import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { ok as okResult } from "@/server/common/responses";
import { countEmissionProducts } from "../../repository/count-emission-products";
import { findCafeById } from "../../repository/find-cafe-by-id";
import { updateCafe } from "../../repository/update-cafe";
import { reviewCafeService } from "../review-cafe-service";
import { submitCafeService } from "../submit-cafe-service";
import { updateCafeService } from "../update-cafe-service";

const row = {
    id: "c1",
    name: "Brújula",
    slug: "brujula",
    description: null,
    address: "Av. Larco 123",
    district: "Miraflores",
    lat: null,
    lng: null,
    photoUrl: null,
    ruc: "20123456789",
    contactPhone: "+51999999999",
    onboardingStatus: "draft" as const,
    reviewNote: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
};
const membership = {
    id: "m1",
    userId: "u1",
    cafeId: "c1",
    role: "owner" as const,
    createdAt: new Date(),
};

describe("updateCafeService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("allows approved cafes to update non-critical fields", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue({
            ...row,
            onboardingStatus: "approved",
        });
        vi.mocked(updateCafe).mockResolvedValue({
            ...row,
            onboardingStatus: "approved",
            description: "Nuevo café",
        });
        const r = await updateCafeService("u1", "c1", {
            description: "Nuevo café",
            contactPhone: "+51999999999",
        });
        expect(r.ok).toBe(true);
        expect(updateCafe).toHaveBeenCalledWith("c1", {
            description: "Nuevo café",
            contactPhone: "+51999999999",
        });
    });

    it("rejects critical edits to approved cafes", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue({
            ...row,
            onboardingStatus: "approved",
        });
        const r = await updateCafeService("u1", "c1", { name: "Otro nombre" });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error.status).toBe(409);
            if (r.error.type === "ConflictError")
                expect(r.error.targets).toEqual(["name"]);
        }
        expect(updateCafe).not.toHaveBeenCalled();
    });

    it("allows draft cafes to update every field", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue(row);
        vi.mocked(updateCafe).mockResolvedValue(row);
        const patch = {
            name: "Nuevo",
            address: "Otra dirección",
            ruc: "20123456789",
        };
        const r = await updateCafeService("u1", "c1", patch);
        expect(r.ok).toBe(true);
        expect(updateCafe).toHaveBeenCalledWith("c1", patch);
    });

    it("rejects all edits to submitted cafes", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue({
            ...row,
            onboardingStatus: "submitted",
        });
        const r = await updateCafeService("u1", "c1", { description: "No" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(409);
        expect(updateCafe).not.toHaveBeenCalled();
    });
});

describe("submitCafeService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("submits a complete draft", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue(row);
        vi.mocked(countEmissionProducts).mockResolvedValue(1);
        vi.mocked(updateCafe).mockResolvedValue({
            ...row,
            onboardingStatus: "submitted",
        });
        const r = await submitCafeService("u1", "c1");
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.onboardingStatus).toBe("submitted");
    });

    it("422 with gap targets when incomplete", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue({ ...row, address: null });
        vi.mocked(countEmissionProducts).mockResolvedValue(0);
        const r = await submitCafeService("u1", "c1");
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error.status).toBe(422);
            if (r.error.type === "UnprocessableEntityError")
                expect(r.error.targets).toEqual(
                    expect.arrayContaining(["address", "emissionProduct"]),
                );
        }
    });

    it("409 when not draft/rejected", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue({
            ...row,
            onboardingStatus: "approved",
        });
        vi.mocked(countEmissionProducts).mockResolvedValue(1);
        const r = await submitCafeService("u1", "c1");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(409);
    });
});

describe("reviewCafeService", () => {
    beforeEach(() => vi.clearAllMocks());
    const ops = { id: "op1", isOps: true };

    it("forbids non-ops", async () => {
        const r = await reviewCafeService({ id: "u1", isOps: false }, "c1", {
            decision: "approved",
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(403);
    });

    it("approves a submitted cafe", async () => {
        vi.mocked(findCafeById).mockResolvedValue({
            ...row,
            onboardingStatus: "submitted",
        });
        vi.mocked(updateCafe).mockResolvedValue({
            ...row,
            onboardingStatus: "approved",
        });
        const r = await reviewCafeService(ops, "c1", { decision: "approved" });
        expect(r.ok).toBe(true);
    });

    it("409 when reviewing a draft", async () => {
        vi.mocked(findCafeById).mockResolvedValue(row);
        const r = await reviewCafeService(ops, "c1", { decision: "approved" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(409);
    });
});
