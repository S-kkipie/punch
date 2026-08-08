import "server-only";
import type { ConsumerTransactionStatus } from "@/core/consumption/domain/types";

export type ChainSubmission = {
    transactionId: string;
    status: ConsumerTransactionStatus;
};
export type ChainTransactionStatus = ChainSubmission & {
    rejectionReason?: string;
};

export interface ConsumerChainPort {
    submitConsumption(input: {
        proofId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission>;
    submitPunchRedemption(input: {
        redemptionRequestId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission>;
    submitVoucherRedemption(input: {
        redemptionRequestId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission>;
    getTransactionStatus(
        transactionId: string,
    ): Promise<ChainTransactionStatus>;
    getPunchBalance(userId: string): Promise<number>;
}

export class ConsumerChainError extends Error {
    constructor(
        public code:
            | "PROOF_NOT_FOUND"
            | "PROOF_NOT_CONFIRMED"
            | "PROOF_EXPIRED"
            | "REQUEST_NOT_FOUND"
            | "REQUEST_NOT_APPROVED"
            | "INSUFFICIENT_BALANCE"
            | "TRANSACTION_NOT_FOUND"
            | "UNSUPPORTED_OPERATION",
        message?: string,
    ) {
        super(message ?? code);
        this.name = "ConsumerChainError";
    }
}
