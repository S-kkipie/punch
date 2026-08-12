import "server-only";

import type { Address } from "viem";
import { env } from "@/config/env";
import arbitrumSepoliaAddresses from "./addresses.arbitrumSepolia.json";
import localAddresses from "./addresses.local.json";

export const contractNames = [
    "cafeRegistry",
    "planManager",
    "consumptionLog",
    "punchVault",
    "networkFund",
    "campaignEscrow",
    "mockPEN",
] as const;

export type ContractName = (typeof contractNames)[number];
export type AddressMap = Record<ContractName, Address>;

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export const addresses: Record<"arbitrumSepolia", AddressMap> = {
    arbitrumSepolia: arbitrumSepoliaAddresses as AddressMap,
};

// Both JSON files are written by scripts/dev-chain.ts, picked by CHAIN_ENV.
// Committed with zero addresses so imports never fail before a first deploy.
export function getAddresses(): AddressMap {
    const map =
        env.CHAIN_ENV === "local"
            ? (localAddresses as AddressMap)
            : addresses.arbitrumSepolia;
    const undeployed = contractNames.filter(
        (name) => map[name].toLowerCase() === ZERO_ADDRESS,
    );
    if (undeployed.length > 0) {
        throw new Error(
            `contracts not deployed for CHAIN_ENV=${env.CHAIN_ENV}: ${undeployed.join(", ")}. Run pnpm chain:deploy against that chain first.`,
        );
    }
    return map;
}
