import { describe, expect, it, vi } from "vitest";

const globalDb = vi.hoisted(() => ({
    insert: vi.fn(() => {
        throw new Error("global db insert should not be used");
    }),
    select: vi.fn(() => {
        throw new Error("global db select should not be used");
    }),
    update: vi.fn(() => {
        throw new Error("global db update should not be used");
    }),
}));

vi.mock("@/server/drizzle/db", () => ({ db: globalDb }));

import {
    type BalanceRepositoryError,
    decrementBalance,
    getBalance,
    incrementBalance,
} from "@/core/punch/server/repository/balance";
import { findProofByNonceOrReceipt } from "../proofs";
import {
    createRedemptionRequest,
    decideRedemptionRequest,
    listFulfillmentRequestsForCafe,
    type RedemptionRequestRepositoryError,
} from "../redemption-requests";
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
    it("validates balance amounts before writing", async () => {
        const client = {} as never;
        for (const amount of [
            0,
            -1,
            1.5,
            Number.NaN,
            Number.POSITIVE_INFINITY,
        ]) {
            await expect(
                incrementBalance(client, "user-1", amount),
            ).rejects.toMatchObject({
                code: "INVALID_AMOUNT",
            } satisfies Partial<BalanceRepositoryError>);
            await expect(
                decrementBalance(client, "user-1", amount),
            ).rejects.toMatchObject({
                code: "INVALID_AMOUNT",
            } satisfies Partial<BalanceRepositoryError>);
        }
    });

    it("guards decrement against insufficient balances atomically", async () => {
        let predicate: unknown;
        const client = {
            update: () => ({
                set: () => ({
                    where: (value: unknown) => {
                        predicate = value;
                        return { returning: async () => [] };
                    },
                }),
            }),
        } as never;
        await expect(
            decrementBalance(client, "user-1", 12),
        ).rejects.toMatchObject({
            code: "INSUFFICIENT_BALANCE",
        });
        const text = predicateText(predicate);
        expect(text).toContain("balance");
        expect(text).toContain("12");
    });

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
});

describe("redemption request safety", () => {
    it("executes redemption request inserts through the injected client", async () => {
        const insertedRow = { id: "request-1", status: "pending" };
        const values = vi.fn().mockReturnValue({
            returning: async () => [insertedRow],
        });
        const insert = vi.fn().mockReturnValue({ values });
        const client = { insert } as never;

        await expect(
            createRedemptionRequest(
                {
                    kind: "punch_reward",
                    consumerUserId: "user-1",
                    cafeId: "cafe-1",
                    productId: "product-1",
                    voucherId: null,
                    status: "pending",
                    decidedByUserId: null,
                    rejectionReason: null,
                },
                client,
            ),
        ).resolves.toBe(insertedRow);

        expect(insert).toHaveBeenCalledOnce();
        expect(values).toHaveBeenCalledOnce();
        expect(globalDb.insert).not.toHaveBeenCalled();
    });

    it("limits the café inbox to recent actionable and settled statuses", async () => {
        let predicate: unknown;
        let limitValue: number | undefined;
        const leftJoinCalls: unknown[][] = [];
        const where = (value: unknown) => {
            predicate = value;
            return {
                orderBy: () => ({
                    limit: (value: number) => {
                        limitValue = value;
                        return Promise.resolve([]);
                    },
                }),
            };
        };
        const client = {
            select: () => ({
                from: () => ({
                    leftJoin: (...args: unknown[]) => {
                        leftJoinCalls.push(args);
                        return {
                            leftJoin: (...args: unknown[]) => {
                                leftJoinCalls.push(args);
                                return { where };
                            },
                        };
                    },
                }),
            }),
        } as never;

        await listFulfillmentRequestsForCafe("cafe-1", client);

        expect(leftJoinCalls).toHaveLength(2);
        const text = predicateText(predicate);
        expect(text).toContain("pending");
        expect(text).toContain("approved");
        expect(text).toContain("confirmed");
        expect(text).toContain("failed");
        expect(text).not.toContain("rejected");
        expect(limitValue).toBe(100);
    });

    it("throws REQUEST_NOT_FOUND through the injected client when the request is absent", async () => {
        const selectPredicates: unknown[] = [];
        const client = {
            update: () => ({
                set: () => ({
                    where: () => ({ returning: async () => [] }),
                }),
            }),
            select: () => ({
                from: () => ({
                    where: async (predicate: unknown) => {
                        selectPredicates.push(predicate);
                        return [];
                    },
                }),
            }),
        } as never;

        await expect(
            decideRedemptionRequest(
                "request-missing",
                "reviewer-1",
                "approved",
                null,
                client,
            ),
        ).rejects.toMatchObject({
            name: "RedemptionRequestRepositoryError",
            code: "REQUEST_NOT_FOUND",
        } satisfies Partial<RedemptionRequestRepositoryError>);

        expect(selectPredicates).toHaveLength(1);
        expect(globalDb.select).not.toHaveBeenCalled();
    });

    it("throws REQUEST_NOT_PENDING for non-pending rows using injected-client classification", async () => {
        const selectPredicates: unknown[] = [];
        const client = {
            update: () => ({
                set: () => ({
                    where: () => ({ returning: async () => [] }),
                }),
            }),
            select: () => ({
                from: () => ({
                    where: async (predicate: unknown) => {
                        selectPredicates.push(predicate);
                        const text = predicateText(predicate);
                        if (text.includes("request-approved")) {
                            return [{ status: "approved" }];
                        }
                        return [];
                    },
                }),
            }),
        } as never;

        await expect(
            decideRedemptionRequest(
                "request-approved",
                "reviewer-1",
                "rejected",
                "duplicate",
                client,
            ),
        ).rejects.toMatchObject({
            name: "RedemptionRequestRepositoryError",
            code: "REQUEST_NOT_PENDING",
        } satisfies Partial<RedemptionRequestRepositoryError>);

        expect(selectPredicates).toHaveLength(1);
        expect(predicateText(selectPredicates[0])).toContain(
            "request-approved",
        );
        expect(globalDb.select).not.toHaveBeenCalled();
    });

    it("returns the updated row after a guarded injected-client decision update", async () => {
        let updatePredicate: unknown;
        const updatedRow = { id: "request-1", status: "approved" };
        const client = {
            update: () => ({
                set: () => ({
                    where: (predicate: unknown) => {
                        updatePredicate = predicate;
                        return { returning: async () => [updatedRow] };
                    },
                }),
            }),
        } as never;

        await expect(
            decideRedemptionRequest(
                "request-1",
                "reviewer-1",
                "approved",
                null,
                client,
            ),
        ).resolves.toBe(updatedRow);

        const text = predicateText(updatePredicate);
        expect(text).toContain("request-1");
        expect(text).toContain("pending");
        expect(globalDb.update).not.toHaveBeenCalled();
    });
});

describe("transaction status transitions", () => {
    it("returns the current row for an idempotent terminal retry", async () => {
        const selected = selectClient([[{ id: "tx-1", status: "confirmed" }]]);
        const client = {
            update: () => ({
                set: () => ({
                    where: () => ({ returning: async () => [] }),
                }),
            }),
            ...selected.client,
        } as never;
        await expect(
            updateTransactionStatus(client, "tx-1", "confirmed"),
        ).resolves.toMatchObject({ id: "tx-1", status: "confirmed" });
    });

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
