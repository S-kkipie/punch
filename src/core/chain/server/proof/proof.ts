import "server-only";

import { isAddress, keccak256, toBytes } from "viem";
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

const PROOF_FIELDS = [
    "cafeId",
    "user",
    "productId",
    "amount",
    "receiptHash",
    "nonce",
    "expiry",
] as const;

const UINT256_MAX = 2n ** 256n - 1n;

function invalidProofField(field: string): never {
    throw new Error(`Invalid proof field: ${field}`);
}

function parseUint256Field(
    raw: Record<string, unknown>,
    field: string,
): bigint {
    const value = raw[field];
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        return invalidProofField(field);
    }

    const parsed = BigInt(value);
    if (parsed > UINT256_MAX) return invalidProofField(field);
    return parsed;
}

export function deserializeProof(raw: unknown): ConsumptionProof {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return invalidProofField("proof");
    }

    const record = raw as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
        keys.length !== PROOF_FIELDS.length ||
        PROOF_FIELDS.some((field) => !Object.hasOwn(record, field)) ||
        keys.some(
            (field) =>
                !PROOF_FIELDS.includes(field as (typeof PROOF_FIELDS)[number]),
        )
    ) {
        return invalidProofField("proof");
    }

    const user = record.user;
    if (typeof user !== "string" || !isAddress(user, { strict: false })) {
        return invalidProofField("user");
    }

    const receiptHash = record.receiptHash;
    if (
        typeof receiptHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(receiptHash)
    ) {
        return invalidProofField("receiptHash");
    }

    return {
        cafeId: parseUint256Field(record, "cafeId"),
        user: user as `0x${string}`,
        productId: parseUint256Field(record, "productId"),
        amount: parseUint256Field(record, "amount"),
        receiptHash: receiptHash as `0x${string}`,
        nonce: parseUint256Field(record, "nonce"),
        expiry: parseUint256Field(record, "expiry"),
    };
}
