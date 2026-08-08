import "server-only";

import type { Address } from "viem";
import { env } from "@/config/env";
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

// Zero until the first deployment (sub-project 2 onward).
export const addresses: Record<"arbitrumSepolia", AddressMap> = {
    arbitrumSepolia: {
        cafeRegistry: ZERO_ADDRESS,
        planManager: ZERO_ADDRESS,
        consumptionLog: ZERO_ADDRESS,
        punchVault: ZERO_ADDRESS,
        networkFund: ZERO_ADDRESS,
        campaignEscrow: ZERO_ADDRESS,
        mockPEN: ZERO_ADDRESS,
    },
};

// addresses.local.json is written by scripts/dev-chain.ts. Committed with
// zero addresses so imports never fail before the first local deploy.
export function getAddresses(): AddressMap {
    if (env.CHAIN_ENV === "local") return localAddresses as AddressMap;
    return addresses.arbitrumSepolia;
}
