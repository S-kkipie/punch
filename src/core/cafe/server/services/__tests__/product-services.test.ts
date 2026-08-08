import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/create-product", () => ({ createProduct: vi.fn() }));
vi.mock("../../repository/find-product-by-id", () => ({
    findProductById: vi.fn(),
}));
vi.mock("../../repository/update-product", () => ({ updateProduct: vi.fn() }));
vi.mock("../../repository/list-products-by-cafe", () => ({
    listProductsByCafe: vi.fn(),
}));
vi.mock("../../repository/list-pending-products", () => ({
    listPendingProducts: vi.fn(),
}));
vi.mock(
    "@/server/auth/membership/require-cafe-role",
    async (importOriginal) => {
        const actual =
            await importOriginal<
                typeof import("@/server/auth/membership/require-cafe-role")
            >();
        return { ...actual, requireCafeRole: vi.fn(), requireOps: vi.fn() };
    },
);

import {
    requireCafeRole,
    requireOps,
} from "@/server/auth/membership/require-cafe-role";
import { ok as okResult } from "@/server/common/responses";
import { createProduct } from "../../repository/create-product";
import { findProductById } from "../../repository/find-product-by-id";
import { listProductsByCafe } from "../../repository/list-products-by-cafe";
import { updateProduct } from "../../repository/update-product";
import { createProductService } from "../create-product-service";
import { listProductsService } from "../list-products-service";
import { reviewProductService } from "../review-product-service";
import { updateProductService } from "../update-product-service";

const productRow = {
    id: "p1",
    cafeId: "c1",
    name: "Latte",
    description: null,
    priceSoles: "10.00",
    cogsSoles: "3.00",
    type: "reward" as const,
    approvalStatus: "approved" as const,
    reviewNote: null,
    active: true,
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
const createInput = {
    name: "Latte",
    priceSoles: "10.00",
    cogsSoles: "3.00",
    type: "reward" as const,
};

beforeEach(() => vi.clearAllMocks());

describe("product services", () => {
    it("creates as owner and starts pending", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(createProduct).mockResolvedValue({
            ...productRow,
            approvalStatus: "pending",
        });
        const r = await createProductService("u1", "c1", createInput);
        expect(r.ok).toBe(true);
        expect(createProduct).toHaveBeenCalledWith(
            expect.objectContaining({
                cafeId: "c1",
                approvalStatus: "pending",
            }),
        );
    });
    it("rejects non-member", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue({
            ok: false,
            error: { status: 403 },
        } as never);
        const r = await createProductService("u1", "c1", createInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(403);
    });
    it("resets approval to pending when price changes", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findProductById).mockResolvedValue(productRow);
        vi.mocked(updateProduct).mockImplementation(async (_id, patch) => ({
            ...productRow,
            ...patch,
        }));
        const r = await updateProductService("u1", "p1", {
            priceSoles: "11.00",
        });
        expect(r.ok).toBe(true);
        expect(updateProduct).toHaveBeenCalledWith(
            "p1",
            expect.objectContaining({ approvalStatus: "pending" }),
        );
    });
    it("keeps approval on cosmetic change", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findProductById).mockResolvedValue(productRow);
        vi.mocked(updateProduct).mockImplementation(async (_id, patch) => ({
            ...productRow,
            ...patch,
        }));
        await updateProductService("u1", "p1", { name: "Latte doble" });
        expect(updateProduct).toHaveBeenCalledWith(
            "p1",
            expect.not.objectContaining({ approvalStatus: "pending" }),
        );
    });
    it("rejects emission to reward without cogs", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findProductById).mockResolvedValue({
            ...productRow,
            type: "emission",
            cogsSoles: null,
        });
        const r = await updateProductService("u1", "p1", { type: "reward" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(422);
    });
    it("rejects reward price over 12 on update", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findProductById).mockResolvedValue(productRow);
        const r = await updateProductService("u1", "p1", {
            priceSoles: "13.00",
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(422);
    });
    it("forbids non-ops review", async () => {
        vi.mocked(requireOps).mockReturnValue({
            ok: false,
            error: { status: 403 },
        } as never);
        const r = await reviewProductService({ id: "u1", isOps: false }, "p1", {
            decision: "approved",
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(403);
    });
    it("conflicts when reviewing approved product", async () => {
        vi.mocked(requireOps).mockReturnValue(okResult(true));
        vi.mocked(findProductById).mockResolvedValue(productRow);
        const r = await reviewProductService({ id: "op", isOps: true }, "p1", {
            decision: "approved",
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(409);
    });
    it("owner list includes pending and inactive products", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(listProductsByCafe).mockResolvedValue([
            productRow,
            { ...productRow, id: "p2", approvalStatus: "pending" },
            { ...productRow, id: "p3", active: false },
        ]);
        const r = await listProductsService({ id: "u1", isOps: false }, "c1");
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    });
    it("public list excludes pending and inactive", async () => {
        vi.mocked(listProductsByCafe).mockResolvedValue([
            productRow,
            { ...productRow, id: "p2", approvalStatus: "pending" },
            { ...productRow, id: "p3", active: false },
        ]);
        const r = await listProductsService(null, "c1");
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.map((p) => p.id)).toEqual(["p1"]);
    });
});
