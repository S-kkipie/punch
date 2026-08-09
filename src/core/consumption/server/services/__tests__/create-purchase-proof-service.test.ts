import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/proofs", () => ({ createQuote: vi.fn() }));
vi.mock("@/core/cafe/server/repository/find-cafe-by-id", () => ({
    findCafeById: vi.fn(),
}));
vi.mock("@/core/cafe/server/repository/find-product-by-id", () => ({
    findProductById: vi.fn(),
}));
vi.mock("@/core/chain/server/wallet/assign-wallet", () => ({
    assignWallet: vi.fn(),
}));
vi.mock("@/core/chain/server/cafe-authorization", () => ({
    isAuthorizedCafeOperator: vi.fn(),
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
import { isAuthorizedCafeOperator } from "@/core/chain/server/cafe-authorization";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { ok as okResult } from "@/server/common/responses";
import { createQuote } from "../../repository/proofs";
import { createPurchaseProofService } from "../create-purchase-proof-service";

const membership = {
    id: "m1",
    userId: "barista-1",
    cafeId: "cafe-1",
    role: "barista" as const,
    createdAt: new Date(),
};
const cafeRow = {
    id: "cafe-1",
    chainCafeId: 7,
    onboardingStatus: "approved" as const,
};
const productRow = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    cafeId: "cafe-1",
    type: "emission" as const,
    approvalStatus: "approved" as const,
    active: true,
    priceSoles: "8.00",
};
const input = { productId: productRow.id, yapeRef: "YAPE-1234" };

function setup() {
    vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
    vi.mocked(findCafeById).mockResolvedValue(cafeRow as never);
    vi.mocked(findProductById).mockResolvedValue(productRow as never);
    vi.mocked(assignWallet).mockResolvedValue({
        walletIndex: 0,
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226",
    });
    vi.mocked(isAuthorizedCafeOperator).mockResolvedValue(true);
    vi.mocked(createQuote).mockImplementation(async (row) => ({
        ...row,
        id: "quote-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        consumerUserId: null,
        purchaseOrderId: null,
        receiptHash: null,
        nonce: null,
        cafeSignature: null,
        consumerSignature: null,
        failureReason: null,
        status: "issued",
    }));
}

describe("createPurchaseProofService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("rejects an operator whose wallet is not chain-authorized", async () => {
        setup();
        vi.mocked(isAuthorizedCafeOperator).mockResolvedValue(false);
        const result = await createPurchaseProofService(
            "barista-1",
            "cafe-1",
            input,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.status).toBe(422);
        expect(createQuote).not.toHaveBeenCalled();
    });

    it("assigns the wallet before reading chain authorization", async () => {
        setup();
        const order: string[] = [];
        vi.mocked(assignWallet).mockImplementation(async () => {
            order.push("wallet");
            return {
                walletIndex: 0,
                address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226",
            };
        });
        vi.mocked(isAuthorizedCafeOperator).mockImplementation(async () => {
            order.push("chain");
            return true;
        });
        await createPurchaseProofService("barista-1", "cafe-1", input);
        expect(order).toEqual(["wallet", "chain"]);
    });

    it("persists a chain-authorized quote without proof secrets", async () => {
        setup();
        const before = Date.now();
        const result = await createPurchaseProofService(
            "barista-1",
            "cafe-1",
            input,
        );
        expect(result.ok).toBe(true);
        expect(createQuote).toHaveBeenCalledWith(
            expect.objectContaining({
                cafeId: "cafe-1",
                productId: productRow.id,
                amountCentimos: 800,
                issuedByUserId: "barista-1",
                yapeRef: "YAPE-1234",
                status: "issued",
                receiptHash: null,
                nonce: null,
                cafeSignature: null,
            }),
        );
        const expiresAt =
            vi.mocked(createQuote).mock.calls[0]?.[0].expiresAt.getTime() ?? 0;
        expect(expiresAt).toBeGreaterThanOrEqual(before + 9 * 60 * 1000);
        expect(expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);
        if (result.ok)
            expect(JSON.stringify(result)).not.toContain("YAPE-1234");
    });
});
