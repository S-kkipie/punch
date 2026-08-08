import "server-only";
import { deriveUserAccount } from "./derive";
import { claimWalletIndex, findUserWallet, setUserWallet } from "./repository";

export type AssignedWallet = { walletIndex: number; address: string };

/**
 * Idempotent custodial wallet assignment. Race-safe: the UPDATE only lands
 * on a still-unassigned row; a lost race re-reads the winner's values.
 * Gaps in the sequence are fine — indexes only need uniqueness.
 */
export async function assignWallet(userId: string): Promise<AssignedWallet> {
    const existing = await findUserWallet(userId);
    if (!existing) throw new Error(`assignWallet: user ${userId} not found`);
    if (existing.walletIndex !== null && existing.walletAddress) {
        return {
            walletIndex: existing.walletIndex,
            address: existing.walletAddress,
        };
    }
    const walletIndex = await claimWalletIndex();
    const account = deriveUserAccount(walletIndex);
    const won = await setUserWallet(userId, walletIndex, account.address);
    if (!won) {
        const winner = await findUserWallet(userId);
        if (!winner || winner.walletIndex === null || !winner.walletAddress) {
            throw new Error(
                `assignWallet: lost race but no wallet on ${userId}`,
            );
        }
        return {
            walletIndex: winner.walletIndex,
            address: winner.walletAddress,
        };
    }
    return { walletIndex, address: account.address };
}
