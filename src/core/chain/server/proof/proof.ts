import "server-only";

import { keccak256, toBytes } from "viem";
import { getAddresses } from "@/core/chain/addresses";
import { chainForEnv } from "@/core/chain/chain";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";

export type ConsumptionProof = {
    cafeId: bigint;
    user: `0x${string}`;
    productId: bigint;
    amount: bigint;
    receiptHash: `0x${string}`;
    nonce: bigint;
    expiry: bigint;
};

type SerializedConsumptionProof = {
    cafeId: string;
    user: `0x${string}`;
    productId: string;
    amount: string;
    receiptHash: `0x${string}`;
    nonce: string;
    expiry: string;
};

const PROOF_TYPES = {
    ConsumptionProof: [
        { name: "cafeId", type: "uint256" },
        { name: "user", type: "address" },
        { name: "productId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "receiptHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
    ],
} as const;

export function buildReceiptHash(
    orderId: string,
    yapeRef: string,
): `0x${string}` {
    return keccak256(toBytes(`${orderId}:${yapeRef}`));
}

export function randomNonce(): bigint {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

export function proofTypedData(proof: ConsumptionProof) {
    return {
        domain: {
            name: "PUNCH ConsumptionLog",
            version: "1",
            chainId: chainForEnv().id,
            verifyingContract: getAddresses().consumptionLog,
        },
        types: PROOF_TYPES,
        primaryType: "ConsumptionProof",
        message: proof,
    } as const;
}

export async function signProofAs(
    walletIndex: number,
    proof: ConsumptionProof,
): Promise<`0x${string}`> {
    return deriveUserAccount(walletIndex).signTypedData(proofTypedData(proof));
}

export function serializeProof(
    proof: ConsumptionProof,
): SerializedConsumptionProof {
    return {
        cafeId: proof.cafeId.toString(),
        user: proof.user,
        productId: proof.productId.toString(),
        amount: proof.amount.toString(),
        receiptHash: proof.receiptHash,
        nonce: proof.nonce.toString(),
        expiry: proof.expiry.toString(),
    };
}

export function deserializeProof(
    raw: SerializedConsumptionProof,
): ConsumptionProof {
    return {
        cafeId: BigInt(raw.cafeId),
        user: raw.user,
        productId: BigInt(raw.productId),
        amount: BigInt(raw.amount),
        receiptHash: raw.receiptHash,
        nonce: BigInt(raw.nonce),
        expiry: BigInt(raw.expiry),
    };
}
