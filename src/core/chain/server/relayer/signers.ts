import "server-only";
import type { Account } from "viem";
import { env } from "@/config/env";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import { deriveOpsAccount } from "@/core/chain/server/wallet/ops-account";
import type { JobSigner } from "./handlers/types";

export function resolveSigner(signer: JobSigner): Account {
    switch (signer.kind) {
        case "relayer":
            return deriveUserAccount(env.RELAYER_WALLET_INDEX);
        case "ops":
            return deriveOpsAccount();
        case "wallet":
            return deriveUserAccount(signer.walletIndex);
    }
}
