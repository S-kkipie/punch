import "server-only";
import { getBalance } from "@/core/punch/server/repository/balance";
import type {
    ChainSubmission,
    ChainTransactionStatus,
    ConsumerChainPort,
} from "./chain-port";
import { ConsumerChainError } from "./chain-port";
import { findTransactionById } from "./repository/transactions";

/**
 * PostgreSQL-backed mock of the real chain. This is the ONLY module allowed
 * to treat consumption/punch tables as command authority — everything else
 * treats them as read projections. Replace with ViemConsumerChain later
 * without touching ConsumerChainPort's callers.
 */
export class PostgresMockConsumerChain implements ConsumerChainPort {
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
        return {
            transactionId: row.id,
            status: row.status,
            rejectionReason: row.rejectionReason ?? undefined,
        };
    }

    async submitConsumption(): Promise<ChainSubmission> {
        throw new ConsumerChainError(
            "UNSUPPORTED_OPERATION",
            "Mock emission write is disabled until Task 6",
        );
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
