import "server-only";
import {
    getBalance,
    incrementBalance,
} from "@/core/punch/server/repository/balance";
import { db } from "@/server/drizzle/db";
import type {
    ChainSubmission,
    ChainTransactionStatus,
    ConsumerChainPort,
} from "./chain-port";
import { ConsumerChainError } from "./chain-port";
import { findProofById } from "./repository/proofs";
import {
    createTransaction,
    findTransactionById,
    findTransactionByIdempotencyKey,
    findTransactionByProofId,
    updateTransactionStatus,
} from "./repository/transactions";

const MOCK_CONFIRM_DELAY_MS = 750;

/**
 * PostgreSQL-backed mock of the real chain. This is the ONLY module allowed
 * to treat consumption/punch tables as command authority — everything else
 * treats them as read projections. Replace with ViemConsumerChain later
 * without touching ConsumerChainPort's callers.
 */
export class PostgresMockConsumerChain implements ConsumerChainPort {
    constructor(
        private readonly now: () => number = Date.now,
        private readonly confirmDelayMs = MOCK_CONFIRM_DELAY_MS,
    ) {}

    async getPunchBalance(userId: string): Promise<number> {
        return getBalance(userId);
    }

    async getTransactionStatus(
        transactionId: string,
    ): Promise<ChainTransactionStatus> {
        const row = await findTransactionById(transactionId);
        if (!row) {
            throw new ConsumerChainError(
                "TRANSACTION_NOT_FOUND",
                `Transaction ${transactionId} not found`,
            );
        }
        if (
            row.status === "pending" &&
            this.now() - row.createdAt.getTime() >= this.confirmDelayMs
        ) {
            return this.finalizePendingTransaction(row.id);
        }
        return {
            transactionId: row.id,
            status: row.status,
            rejectionReason: row.rejectionReason ?? undefined,
        };
    }

    async submitConsumption(input: {
        proofId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission> {
        const existing = await findTransactionByIdempotencyKey(
            input.idempotencyKey,
        );
        if (existing)
            return { transactionId: existing.id, status: existing.status };

        try {
            return await db.transaction(async (tx) => {
                const proof = await findProofById(input.proofId, tx);
                if (!proof) throw new ConsumerChainError("PROOF_NOT_FOUND");
                if (proof.status !== "confirmed" || !proof.consumerUserId) {
                    throw new ConsumerChainError("PROOF_NOT_CONFIRMED");
                }
                if (proof.expiresAt.getTime() <= this.now()) {
                    throw new ConsumerChainError("PROOF_EXPIRED");
                }

                const already = await findTransactionByProofId(tx, proof.id);
                if (already)
                    return {
                        transactionId: already.id,
                        status: already.status,
                    };

                const row = await createTransaction(tx, {
                    operation: "emission",
                    consumerUserId: proof.consumerUserId,
                    cafeId: proof.cafeId,
                    proofId: proof.id,
                    chainTxId: `mock_${crypto.randomUUID()}`,
                    status: "pending",
                    idempotencyKey: input.idempotencyKey,
                    redemptionRequestId: null,
                    rejectionReason: null,
                });
                return { transactionId: row.id, status: row.status };
            });
        } catch (cause) {
            // A concurrent request may win either unique constraint. Re-read
            // both identities and return its result instead of surfacing 500.
            const byKey = await findTransactionByIdempotencyKey(
                input.idempotencyKey,
            );
            if (byKey) return { transactionId: byKey.id, status: byKey.status };
            const byProof = await findTransactionByProofId(db, input.proofId);
            if (byProof)
                return { transactionId: byProof.id, status: byProof.status };
            throw cause;
        }
    }

    private async finalizePendingTransaction(
        transactionId: string,
    ): Promise<ChainTransactionStatus> {
        return db.transaction(async (tx) => {
            const row = await findTransactionById(transactionId, tx, true);
            if (!row) throw new ConsumerChainError("TRANSACTION_NOT_FOUND");
            if (row.status !== "pending") {
                return { transactionId: row.id, status: row.status };
            }
            if (row.operation !== "emission" || !row.proofId) {
                throw new ConsumerChainError("UNSUPPORTED_OPERATION");
            }
            const proof = await findProofById(row.proofId, tx);
            if (!proof?.consumerUserId) {
                throw new ConsumerChainError("PROOF_NOT_CONFIRMED");
            }
            await incrementBalance(tx, proof.consumerUserId, 1);
            const confirmed = await updateTransactionStatus(
                tx,
                row.id,
                "confirmed",
            );
            return { transactionId: confirmed.id, status: confirmed.status };
        });
    }

    async submitPunchRedemption(): Promise<ChainSubmission> {
        throw new ConsumerChainError(
            "UNSUPPORTED_OPERATION",
            "Mock PUNCH redemption write is disabled until Task 8",
        );
    }

    async submitVoucherRedemption(): Promise<ChainSubmission> {
        throw new ConsumerChainError(
            "UNSUPPORTED_OPERATION",
            "Mock voucher redemption write is disabled until Task 9",
        );
    }
}
