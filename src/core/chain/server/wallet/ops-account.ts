import "server-only";
import type { HDAccount } from "viem/accounts";
import { env } from "@/config/env";
import { deriveAccount } from "./derive";

/**
 * Owner of CampaignEscrow. Separate from the relayer key, which signs on every
 * purchase and is the most exposed key in the system.
 */
export function deriveOpsAccount(): HDAccount {
    return deriveAccount(env.WALLET_MASTER_MNEMONIC, env.OPS_WALLET_INDEX);
}
