import "server-only";
import { type HDAccount, mnemonicToAccount } from "viem/accounts";
import { env } from "@/config/env";

/** Pure HD derivation at m/44'/60'/0'/0/{addressIndex}. Test seam. */
export function deriveAccount(
    mnemonic: string,
    addressIndex: number,
): HDAccount {
    if (!Number.isInteger(addressIndex) || addressIndex < 0) {
        throw new Error(`Invalid wallet index: ${addressIndex}`);
    }
    return mnemonicToAccount(mnemonic, { addressIndex });
}

/** Derives the custodial account for a user's assigned wallet index. */
export function deriveUserAccount(addressIndex: number): HDAccount {
    return deriveAccount(env.WALLET_MASTER_MNEMONIC, addressIndex);
}
