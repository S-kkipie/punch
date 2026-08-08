import "server-only";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import type { ChainTransactionStatus } from "../chain-port";
import { ConsumerChainError } from "../chain-port";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import {
    findTransactionById,
    findTransactionByIdForConsumer,
} from "../repository/transactions";

export async function getTransactionStatusService(
    requestingUserId: string,
    transactionId: string,
    cafeId?: string,
): AsyncAppResult<ChainTransactionStatus> {
    const owned = await findTransactionByIdForConsumer(
        transactionId,
        requestingUserId,
    );
    let authorized = Boolean(owned);
    if (!authorized && cafeId) {
        const transaction = await findTransactionById(transactionId);
        const isRedemption =
            transaction?.operation === "punch_redemption" ||
            transaction?.operation === "voucher_redemption";
        if (transaction && isRedemption && transaction.cafeId === cafeId) {
            const membership = await requireCafeRole(requestingUserId, cafeId, [
                "owner",
                "barista",
            ]);
            authorized = membership.ok;
        }
    }
    if (!authorized) {
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
