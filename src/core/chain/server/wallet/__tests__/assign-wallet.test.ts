import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repository", () => ({
    findUserWallet: vi.fn(),
    claimWalletIndex: vi.fn(),
    setUserWallet: vi.fn(),
}));
vi.mock("../derive", () => ({
    deriveUserAccount: vi.fn(),
}));

import { assignWallet } from "../assign-wallet";
import { deriveUserAccount } from "../derive";
import { claimWalletIndex, findUserWallet, setUserWallet } from "../repository";

const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("assignWallet", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns existing wallet without touching the sequence", async () => {
        vi.mocked(findUserWallet).mockResolvedValue({
            walletIndex: 4,
            walletAddress: ADDR,
        });
        const r = await assignWallet("u1");
        expect(r).toEqual({ walletIndex: 4, address: ADDR });
        expect(claimWalletIndex).not.toHaveBeenCalled();
    });

    it("claims an index, derives, persists", async () => {
        vi.mocked(findUserWallet).mockResolvedValue({
            walletIndex: null,
            walletAddress: null,
        });
        vi.mocked(claimWalletIndex).mockResolvedValue(9);
        vi.mocked(deriveUserAccount).mockReturnValue({
            address: ADDR,
        } as never);
        vi.mocked(setUserWallet).mockResolvedValue(true);
        const r = await assignWallet("u1");
        expect(deriveUserAccount).toHaveBeenCalledWith(9);
        expect(setUserWallet).toHaveBeenCalledWith("u1", 9, ADDR);
        expect(r).toEqual({ walletIndex: 9, address: ADDR });
    });

    it("on lost race returns the winner's wallet", async () => {
        vi.mocked(findUserWallet)
            .mockResolvedValueOnce({ walletIndex: null, walletAddress: null })
            .mockResolvedValueOnce({ walletIndex: 2, walletAddress: ADDR });
        vi.mocked(claimWalletIndex).mockResolvedValue(9);
        vi.mocked(deriveUserAccount).mockReturnValue({
            address: "0x0000000000000000000000000000000000000001",
        } as never);
        vi.mocked(setUserWallet).mockResolvedValue(false);
        const r = await assignWallet("u1");
        expect(r).toEqual({ walletIndex: 2, address: ADDR });
    });

    it("throws when user does not exist", async () => {
        vi.mocked(findUserWallet).mockResolvedValue(null);
        await expect(assignWallet("ghost")).rejects.toThrow(/not found/);
    });
});
