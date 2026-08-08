import "server-only";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import type { ChainTransactionStatus } from "../chain-port";
import { ConsumerChainError } from "../chain-port";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import { findTransactionByIdForConsumer } from "../repository/transactions";

export async function getTransactionStatusService(
    consumerUserId: string,
    transactionId: string,
): AsyncAppResult<ChainTransactionStatus> {
    const owned = await findTransactionByIdForConsumer(
        transactionId,
        consumerUserId,
    );
    if (!owned) {
        return err(AppErrors.notFound({ targets: ["transactionId"] }));
    }
    try {
        return ok(
            await new PostgresMockConsumerChain().getTransactionStatus(
                transactionId,
            ),
        );
    } catch (cause) {
        if (cause instanceof ConsumerChainError) {
            return err(AppErrors.notFound({ targets: ["transactionId"] }));
        }
        return err(AppErrors.unexpected(cause));
    }
}
