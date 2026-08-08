import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/proofs", () => ({ createProof: vi.fn() }));
vi.mock("@/core/cafe/server/repository/find-cafe-by-id", () => ({
    findCafeById: vi.fn(),
}));
vi.mock("@/core/cafe/server/repository/find-product-by-id", () => ({
    findProductById: vi.fn(),
}));
vi.mock("@/core/chain/server/wallet/assign-wallet", () => ({
    assignWallet: vi.fn(),
}));
vi.mock("@/core/chain/server/wallet/derive", () => ({
    deriveUserAccount: vi.fn(),
}));
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

import { findCafeById } from "@/core/cafe/server/repository/find-cafe-by-id";
import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { ok as okResult } from "@/server/common/responses";
import { createProof } from "../../repository/proofs";
import { createPurchaseProofService } from "../create-purchase-proof-service";

const membership = {
    id: "m1",
    userId: "barista-1",
    cafeId: "cafe-1",
    role: "barista" as const,
    createdAt: new Date(),
};
const cafeRow = { id: "cafe-1", onboardingStatus: "approved" as const };
const productRow = {
    id: "product-1",
    cafeId: "cafe-1",
    type: "emission" as const,
    approvalStatus: "approved" as const,
    active: true,
    priceSoles: "8.00",
};

describe("createPurchaseProofService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("forbids a user without barista/owner membership", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue({
            ok: false,
            error: { type: "ForbiddenError", code: "FORBIDDEN", status: 403 },
        });
        const result = await createPurchaseProofService("outsider", "cafe-1", {
            productId: "product-1",
            receiptHash: `0x${"ab".repeat(32)}`,
        });
        expect(result.ok).toBe(false);
    });

    it("rejects a product that cannot emit PUNCH", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue(cafeRow as never);
        vi.mocked(findProductById).mockResolvedValue({
            ...productRow,
            type: "reward",
        } as never);
        const result = await createPurchaseProofService("barista-1", "cafe-1", {
            productId: "product-1",
            receiptHash: `0x${"ab".repeat(32)}`,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it("signs and persists a proof for a valid emission product", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue(cafeRow as never);
        vi.mocked(findProductById).mockResolvedValue(productRow as never);
        vi.mocked(assignWallet).mockResolvedValue({
            walletIndex: 0,
            address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226",
        });
        vi.mocked(deriveUserAccount).mockReturnValue({
            signTypedData: vi.fn().mockResolvedValue(`0x${"cd".repeat(65)}`),
        } as never);
        vi.mocked(createProof).mockImplementation(async (input) => ({
            ...input,
            id: "proof-1",
            createdAt: new Date(),
            updatedAt: new Date(),
            consumerUserId: null,
            consumerSignature: null,
            status: "issued",
        }));
        const result = await createPurchaseProofService("barista-1", "cafe-1", {
            productId: "product-1",
            receiptHash: `0x${"ab".repeat(32)}`,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.deepLink).toBe("/purchase/proof-1");
        expect(createProof).toHaveBeenCalledWith(
            expect.objectContaining({
                cafeId: "cafe-1",
                productId: "product-1",
                amountCentimos: 800,
                cafeSignature: expect.stringMatching(/^0x[0-9a-f]{130}$/),
                status: "issued",
            }),
        );
    });
});
