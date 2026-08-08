import { describe, expect, it } from "vitest";
import { getBalance } from "@/core/punch/server/repository/balance";
import {
    bindProofSignatures,
    findProofByNonceOrReceipt,
    type ProofRepositoryError,
} from "../proofs";
import {
    findTransactionByIdempotencyKey,
    type TransactionRepositoryError,
    updateTransactionStatus,
} from "../transactions";

function selectClient(rows: unknown[][]) {
    let call = 0;
    return {
        select: () => ({
            from: () => ({
                where: async () => rows[call++] ?? [],
            }),
        }),
    };
}

describe("transaction-safe repository reads", () => {
    it("uses the supplied client for balance and idempotency reads", async () => {
        const client = selectClient([[{ balance: 7 }], [{ id: "tx-1" }]]);
        await expect(getBalance("user-1", client as never)).resolves.toBe(7);
        await expect(
            findTransactionByIdempotencyKey("key-1", client as never),
        ).resolves.toMatchObject({ id: "tx-1" });
    });
});

describe("proof repository safety", () => {
    it("rejects nonce and receipt matches that identify different proofs", async () => {
        const client = selectClient([
            [{ id: "proof-by-nonce" }],
            [{ id: "proof-by-receipt" }],
        ]);
        await expect(
            findProofByNonceOrReceipt("nonce", "receipt", client as never),
        ).rejects.toMatchObject({ code: "PROOF_COLLISION" });
    });

    it("reports an expired issued proof after the guarded update misses", async () => {
        const client = {
            update: () => ({
                set: () => ({
                    where: () => ({ returning: async () => [] }),
                }),
            }),
            ...selectClient([
                [{ status: "issued", expiresAt: new Date(Date.now() - 1) }],
            ]),
        } as never;
        await expect(
            bindProofSignatures(
                "proof-1",
                "user-1",
                "cafe-sig",
                "consumer-sig",
                client,
            ),
        ).rejects.toMatchObject({
            name: "ProofRepositoryError",
            code: "PROOF_EXPIRED",
        } satisfies Partial<ProofRepositoryError>);
    });
});

describe("transaction status transitions", () => {
    it("allows pending to confirmed", async () => {
        const client = {
            update: () => ({
                set: () => ({
                    where: () => ({
                        returning: async () => [
                            { id: "tx-1", status: "confirmed" },
                        ],
                    }),
                }),
            }),
        } as never;
        await expect(
            updateTransactionStatus(client, "tx-1", "confirmed"),
        ).resolves.toMatchObject({ status: "confirmed" });
    });

    it("rejects terminal-state rewrites", async () => {
        const client = {
            update: () => ({
                set: () => ({
                    where: () => ({ returning: async () => [] }),
                }),
            }),
            ...selectClient([[{ status: "confirmed" }]]),
        } as never;
        await expect(
            updateTransactionStatus(client, "tx-1", "failed"),
        ).rejects.toMatchObject({
            name: "TransactionRepositoryError",
            code: "INVALID_TRANSITION",
        } satisfies Partial<TransactionRepositoryError>);
    });
});
