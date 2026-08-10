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
import { findRedemptionSettlementById } from "../repository/redemption-requests";
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
    const settlement = await findRedemptionSettlementById(transactionId);
    const legacyTransaction = settlement
        ? null
        : await findTransactionById(transactionId);
    let authorized = Boolean(owned);
    if (!authorized && settlement?.consumerUserId === requestingUserId) {
        authorized = true;
    }
    const cafeSettlement = settlement ?? legacyTransaction;
    if (
        !authorized &&
        cafeId &&
        cafeSettlement &&
        cafeSettlement.cafeId === cafeId &&
        (settlement !== null ||
            legacyTransaction?.operation === "punch_redemption" ||
            legacyTransaction?.operation === "voucher_redemption")
    ) {
        const membership = await requireCafeRole(requestingUserId, cafeId, [
            "owner",
            "barista",
        ]);
        authorized = membership.ok;
    }
    if (!authorized) {
        return err(AppErrors.notFound({ targets: ["transactionId"] }));
    }
    if (settlement) {
        return ok({
            transactionId: settlement.id,
            status: settlement.status,
            ...(settlement.rejectionReason
                ? { rejectionReason: settlement.rejectionReason }
                : {}),
        });
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
