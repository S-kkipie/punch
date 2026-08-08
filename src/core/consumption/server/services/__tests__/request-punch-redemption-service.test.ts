import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../repository/redemption-requests", () => ({ createRedemptionRequest: vi.fn() }));
vi.mock("@/core/cafe/server/repository/find-product-by-id", () => ({ findProductById: vi.fn() }));
vi.mock("@/core/punch/server/repository/balance", () => ({ getBalance: vi.fn() }));
import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { getBalance } from "@/core/punch/server/repository/balance";
import { createRedemptionRequest } from "../../repository/redemption-requests";
import { requestPunchRedemptionService } from "../request-punch-redemption-service";
const product = { id: "p", cafeId: "c", type: "reward" as const, approvalStatus: "approved" as const, active: true };
describe("requestPunchRedemptionService", () => {
 beforeEach(() => vi.clearAllMocks());
 it.each([11, 0])("blocks balance %s", async (balance) => { vi.mocked(getBalance).mockResolvedValue(balance); vi.mocked(findProductById).mockResolvedValue(product as never); const r = await requestPunchRedemptionService("u", "c", { productId: "p" }); expect(r.ok).toBe(false); expect(createRedemptionRequest).not.toHaveBeenCalled(); });
 it.each([{ ...product, cafeId: "other" }, { ...product, type: "standard" }, { ...product, approvalStatus: "pending" }, { ...product, active: false }])("blocks invalid reward product", async (p) => { vi.mocked(getBalance).mockResolvedValue(12); vi.mocked(findProductById).mockResolvedValue(p as never); const r = await requestPunchRedemptionService("u", "c", { productId: "p" }); expect(r.ok).toBe(false); });
 it("creates exactly the fixed-cost pending request at 12", async () => { vi.mocked(getBalance).mockResolvedValue(12); vi.mocked(findProductById).mockResolvedValue(product as never); vi.mocked(createRedemptionRequest).mockResolvedValue({ id: "r", kind: "punch_reward", cafeId: "c", productId: "p", voucherId: null, status: "pending", rejectionReason: null, createdAt: new Date() } as never); const r = await requestPunchRedemptionService("u", "c", { productId: "p" }); expect(r.ok).toBe(true); expect(createRedemptionRequest).toHaveBeenCalledWith(expect.objectContaining({ kind: "punch_reward", status: "pending" })); });
});
