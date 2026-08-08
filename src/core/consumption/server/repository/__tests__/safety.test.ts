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

function predicateText(value: unknown, seen = new Set<unknown>()): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number") {
        return String(value);
    }
    if (typeof value !== "object" || seen.has(value)) return "";
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => predicateText(item, seen)).join(" ");
    }
    const record = value as Record<string, unknown>;
    return [record.name, record.value, record.queryChunks]
        .map((item) => predicateText(item, seen))
        .join(" ");
}

function selectClient(rows: unknown[][]) {
    let call = 0;
    const predicates: unknown[] = [];
    return {
        predicates,
        client: {
            select: () => ({
                from: () => ({
                    where: async (predicate: unknown) => {
                        predicates.push(predicate);
                        return rows[call++] ?? [];
                    },
                }),
            }),
        },
    };
}

describe("transaction-safe repository reads", () => {
    it("uses the supplied client for balance and idempotency reads", async () => {
        const { client, predicates } = selectClient([
            [{ balance: 7 }],
            [{ id: "tx-1" }],
        ]);
        await expect(getBalance("user-1", client as never)).resolves.toBe(7);
        await expect(
            findTransactionByIdempotencyKey("key-1", client as never),
        ).resolves.toMatchObject({ id: "tx-1" });
        expect(predicates).toHaveLength(2);
    });
});

describe("proof repository safety", () => {
    it("rejects nonce and receipt matches that identify different proofs", async () => {
        const { client, predicates } = selectClient([
            [
                {
                    id: "proof-by-nonce",
                    nonce: "nonce",
                    receiptHash: "other-receipt",
                },
                {
                    id: "proof-by-receipt",
                    nonce: "other-nonce",
                    receiptHash: "receipt",
                },
            ],
        ]);
        await expect(
            findProofByNonceOrReceipt("nonce", "receipt", client as never),
        ).rejects.toMatchObject({ code: "PROOF_COLLISION" });
        expect(predicates).toHaveLength(1);
        const lookupPredicate = predicateText(predicates[0]);
        expect(lookupPredicate).toContain("nonce");
        expect(lookupPredicate).toContain("receipt_hash");
    });

    it("reports an expired issued proof after the guarded update misses", async () => {
        const selected = selectClient([[{ status: "issued", expired: true }]]);
        let updatePredicate: unknown;
        const client = {
            update: () => ({
                set: () => ({
                    where: (predicate: unknown) => {
                        updatePredicate = predicate;
                        return { returning: async () => [] };
                    },
                }),
            }),
            ...selected.client,
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
        const updateText = predicateText(updatePredicate);
        expect(updateText).toContain("id");
        expect(updateText).toContain("status");
        expect(updateText).toContain("expires_at");
        expect(updateText).toContain("now");
        expect(selected.predicates).toHaveLength(1);
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
        const selected = selectClient([[{ status: "confirmed" }]]);
        const client = {
            update: () => ({
                set: () => ({
                    where: () => ({ returning: async () => [] }),
                }),
            }),
            ...selected.client,
        } as never;
        await expect(
            updateTransactionStatus(client, "tx-1", "failed"),
        ).rejects.toMatchObject({
            name: "TransactionRepositoryError",
            code: "INVALID_TRANSITION",
        } satisfies Partial<TransactionRepositoryError>);
    });
});
