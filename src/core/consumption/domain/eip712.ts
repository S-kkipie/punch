import type { TypedDataDomain } from "viem";

export const PURCHASE_PROOF_TYPES = {
    PurchaseProof: [
        { name: "cafeId", type: "string" },
        { name: "user", type: "address" },
        { name: "productId", type: "string" },
        { name: "amountCentimos", type: "uint256" },
        { name: "receiptHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
        { name: "expiry", type: "uint256" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
    ],
} as const;

export type PurchaseProofMessage = {
    cafeId: string;
    user: `0x${string}`;
    productId: string;
    amountCentimos: bigint;
    receiptHash: `0x${string}`;
    nonce: `0x${string}`;
    expiry: bigint;
    chainId: bigint;
    verifyingContract: `0x${string}`;
};

/** Demo verifying-domain context. Production must supply the deployed contract. */
export function purchaseProofDomain(params: {
    verifyingContract: `0x${string}`;
    chainId: number;
}): TypedDataDomain {
    return {
        name: "PunchConsumption",
        version: "1",
        chainId: params.chainId,
        verifyingContract: params.verifyingContract,
    };
}

/** Server clock authority — never trust the client clock for expiry. */
export function isProofExpired(expiry: bigint, nowSeconds: number): boolean {
    return BigInt(nowSeconds) >= expiry;
}

export const PURCHASE_PROOF_TTL_SECONDS = 120;
