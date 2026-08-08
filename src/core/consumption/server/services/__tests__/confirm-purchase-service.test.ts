import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/proofs", () => ({
    findProofById: vi.fn(),
    bindProofSignatures: vi.fn(),
}));
vi.mock("@/core/chain/server/wallet/assign-wallet", () => ({
    assignWallet: vi.fn(),
}));
vi.mock("@/core/chain/server/wallet/derive", () => ({
    deriveUserAccount: vi.fn((index: number) => ({
        address:
            index === 1
                ? "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
                : "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        signTypedData: vi.fn().mockResolvedValue(`0xsig-${index}`),
    })),
}));
vi.mock("../../postgres-mock-chain", () => ({
    PostgresMockConsumerChain: vi.fn().mockImplementation(() => ({
        submitConsumption: vi.fn().mockResolvedValue({
            transactionId: "tx-1",
            status: "pending",
        }),
    })),
}));

import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { bindProofSignatures, findProofById } from "../../repository/proofs";
import { confirmPurchaseService } from "../confirm-purchase-service";

const issuedProof = {
    id: "proof-1",
    status: "issued",
    issuedByUserId: "cafe-user-1",
    cafeId: "cafe-1",
    productId: "product-1",
    amountCentimos: 1200,
    receiptHash: `0x${"11".repeat(32)}`,
    nonce: `0x${"22".repeat(32)}`,
    expiresAt: new Date(Date.now() + 60_000),
};

describe("confirmPurchaseService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("rejects an expired proof before assigning wallets or signing", async () => {
        vi.mocked(findProofById).mockResolvedValue({
            ...issuedProof,
            expiresAt: new Date(Date.now() - 1000),
        } as never);

        const result = await confirmPurchaseService("user-1", {
            proofId: "proof-1",
        });

        expect(result.ok).toBe(false);
        expect(assignWallet).not.toHaveBeenCalled();
    });

    it("binds two signatures over the same final consumer-bound typed payload", async () => {
        vi.mocked(findProofById).mockResolvedValue(issuedProof as never);
        vi.mocked(assignWallet)
            .mockResolvedValueOnce({ walletIndex: 1, address: "0xconsumer" })
            .mockResolvedValueOnce({ walletIndex: 2, address: "0xcafe" });
        vi.mocked(bindProofSignatures).mockResolvedValue({
            id: "proof-1",
        } as never);

        const result = await confirmPurchaseService("user-1", {
            proofId: "proof-1",
        });

        expect(result).toEqual({
            ok: true,
            data: { transactionId: "tx-1", status: "pending" },
        });
        expect(bindProofSignatures).toHaveBeenCalledWith(
            "proof-1",
            "user-1",
            "0xsig-2",
            "0xsig-1",
        );
    });
});
