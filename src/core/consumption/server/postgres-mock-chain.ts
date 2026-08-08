import "server-only";
import { isEligibleForAcquisitionCampaign } from "@/core/punch/domain/campaign";
import {
    advanceCrawl,
    type CrawlStepDefinition,
} from "@/core/punch/domain/crawl";
import { PUNCH_REDEMPTION_COST } from "@/core/punch/domain/progress";
import {
    decrementBalance,
    getBalance,
    incrementBalance,
} from "@/core/punch/server/repository/balance";
import {
    findActiveCampaignForCafe,
    hasPriorPaidPurchase,
    unlockCampaignVoucher,
} from "@/core/punch/server/repository/campaigns";
import {
    advanceCrawlProgress,
    findActiveCrawlForCafe,
    getCrawlSteps,
    getOrCreateCrawlProgress,
    unlockCrawlVoucher,
} from "@/core/punch/server/repository/crawls";
import {
    markVoucherExpiredIfAvailable,
    markVoucherRedeemed,
    VoucherRepositoryError,
} from "@/core/punch/server/repository/vouchers";
import { db } from "@/server/drizzle/db";
import type {
    ChainSubmission,
    ChainTransactionStatus,
    ConsumerChainPort,
} from "./chain-port";
import { ConsumerChainError } from "./chain-port";
import { findProofById } from "./repository/proofs";
import { findRedemptionRequestById } from "./repository/redemption-requests";
import * as transactionRepository from "./repository/transactions";
import {
    createTransaction,
    findTransactionById,
    findTransactionByIdempotencyKey,
    findTransactionByProofId,
    findTransactionByRedemptionRequestId,
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
            if (row.operation === "voucher_redemption") {
                if (!row.redemptionRequestId)
                    throw new ConsumerChainError("REQUEST_NOT_FOUND");
                const request = await findRedemptionRequestById(
                    row.redemptionRequestId,
                    tx,
                );
                if (request?.status !== "approved" || !request.voucherId) {
                    throw new ConsumerChainError("REQUEST_NOT_APPROVED");
                }
                try {
                    await markVoucherRedeemed(tx, request.voucherId);
                } catch (cause) {
                    if (!(cause instanceof VoucherRepositoryError)) throw cause;
                    if (cause.code === "EXPIRED") {
                        await markVoucherExpiredIfAvailable(
                            tx,
                            request.voucherId,
                        );
                    }
                    const rejected = await updateTransactionStatus(
                        tx,
                        row.id,
                        "rejected",
                        cause.code === "EXPIRED"
                            ? "El voucher venció antes de confirmarse."
                            : "El voucher ya fue utilizado o no está disponible.",
                    );
                    return {
                        transactionId: rejected.id,
                        status: rejected.status,
                        rejectionReason: rejected.rejectionReason ?? undefined,
                    };
                }
                const confirmed = await updateTransactionStatus(
                    tx,
                    row.id,
                    "confirmed",
                    null,
                    { modeledHostPayoutCentimos: null },
                );
                return {
                    transactionId: confirmed.id,
                    status: confirmed.status,
                };
            }
            if (row.operation === "punch_redemption") {
                if (!row.redemptionRequestId)
                    throw new ConsumerChainError("REQUEST_NOT_FOUND");
                const request = await findRedemptionRequestById(
                    row.redemptionRequestId,
                    tx,
                );
                if (request?.status !== "approved") {
                    throw new ConsumerChainError("REQUEST_NOT_APPROVED");
                }
                try {
                    await decrementBalance(
                        tx,
                        row.consumerUserId,
                        PUNCH_REDEMPTION_COST,
                    );
                } catch (cause) {
                    if (
                        cause instanceof Error &&
                        "code" in cause &&
                        cause.code === "INSUFFICIENT_BALANCE"
                    ) {
                        const rejected = await updateTransactionStatus(
                            tx,
                            row.id,
                            "rejected",
                            "Necesitas 12 PUNCH para canjear.",
                        );
                        return {
                            transactionId: rejected.id,
                            status: rejected.status,
                            rejectionReason:
                                rejected.rejectionReason ?? undefined,
                        };
                    }
                    throw cause;
                }
                const confirmed = await updateTransactionStatus(
                    tx,
                    row.id,
                    "confirmed",
                    null,
                    { modeledHostPayoutCentimos: 360 },
                );
                return {
                    transactionId: confirmed.id,
                    status: confirmed.status,
                };
            }
            if (row.operation !== "emission" || !row.proofId) {
                throw new ConsumerChainError("UNSUPPORTED_OPERATION");
            }
            const proof = await findProofById(row.proofId, tx);
            if (!proof?.consumerUserId) {
                throw new ConsumerChainError("PROOF_NOT_CONFIRMED");
            }
            await incrementBalance(tx, proof.consumerUserId, 1);

            const activeCampaign = await findActiveCampaignForCafe(
                tx,
                proof.cafeId,
            );
            if (activeCampaign) {
                const priorPurchase = await hasPriorPaidPurchase(
                    tx,
                    proof.consumerUserId,
                    proof.cafeId,
                    { id: row.id, createdAt: row.createdAt },
                );
                const purchaseAt = new Date();
                const eligible = isEligibleForAcquisitionCampaign({
                    campaignCafeId: activeCampaign.cafeId,
                    purchaseCafeId: proof.cafeId,
                    hadPriorPaidPurchaseAtCafe: priorPurchase,
                    purchaseAt,
                    campaignWindowStart: activeCampaign.windowStart,
                    campaignWindowEnd: activeCampaign.windowEnd,
                });
                if (eligible) {
                    await unlockCampaignVoucher(tx, {
                        campaignId: activeCampaign.id,
                        consumerUserId: proof.consumerUserId,
                        cafeId: proof.cafeId,
                        expiresAt: activeCampaign.windowEnd,
                    });
                }
            }

            const activeCrawl = await findActiveCrawlForCafe(tx, proof.cafeId);
            if (activeCrawl) {
                const steps: CrawlStepDefinition[] = (
                    await getCrawlSteps(tx, activeCrawl.id)
                ).map((step) => ({
                    stepIndex: step.stepIndex,
                    cafeId: step.cafeId,
                }));
                const progress = await getOrCreateCrawlProgress(
                    tx,
                    activeCrawl.id,
                    proof.consumerUserId,
                );
                const crawlAdvance = advanceCrawl({
                    steps,
                    completedCafeIds: progress.completedCafeIds,
                    purchaseCafeId: proof.cafeId,
                    now: new Date(),
                    crawlExpiresAt: activeCrawl.expiresAt,
                });
                if (crawlAdvance.advanced) {
                    const nextCompleted = [
                        ...progress.completedCafeIds,
                        proof.cafeId,
                    ];
                    await advanceCrawlProgress(
                        tx,
                        progress.id,
                        nextCompleted,
                        crawlAdvance.crawlCompleted,
                    );
                    if (crawlAdvance.crawlCompleted) {
                        await unlockCrawlVoucher(tx, {
                            crawlId: activeCrawl.id,
                            consumerUserId: proof.consumerUserId,
                            expiresAt: activeCrawl.expiresAt,
                        });
                    }
                }
            }

            const confirmed = await updateTransactionStatus(
                tx,
                row.id,
                "confirmed",
            );
            const crawl = await findActiveCrawlForCafe(tx, proof.cafeId);
            if (crawl) {
                const steps = (await getCrawlSteps(tx, crawl.id)).map(
                    (step) => ({
                        stepIndex: step.stepIndex,
                        cafeId: step.cafeId,
                    }),
                );
                const progress = await getOrCreateCrawlProgress(
                    tx,
                    crawl.id,
                    proof.consumerUserId,
                );
                let confirmedCafeIds: string[] = [];
                try {
                    const listConfirmed =
                        transactionRepository.listConfirmedEmissionCafeIds;
                    if (listConfirmed) {
                        confirmedCafeIds = await listConfirmed(
                            tx,
                            proof.consumerUserId,
                            steps.map((step) => step.cafeId),
                        );
                    }
                } catch {
                    // Older isolated repository mocks omit the optional reconciliation read.
                }
                const confirmedCafes = new Set(confirmedCafeIds);
                let completedCafeIds = [...progress.completedCafeIds];
                while (completedCafeIds.length < steps.length) {
                    const next = steps[completedCafeIds.length];
                    if (!next || !confirmedCafes.has(next.cafeId)) break;
                    completedCafeIds = [...completedCafeIds, next.cafeId];
                }
                if (
                    completedCafeIds.length > progress.completedCafeIds.length
                ) {
                    const completed = completedCafeIds.length === steps.length;
                    await advanceCrawlProgress(
                        tx,
                        progress.id,
                        completedCafeIds,
                        completed,
                    );
                    if (completed) {
                        await unlockCrawlVoucher(tx, {
                            crawlId: crawl.id,
                            consumerUserId: proof.consumerUserId,
                            expiresAt: crawl.expiresAt,
                        });
                    }
                }
            }
            return { transactionId: confirmed.id, status: confirmed.status };
        });
    }

    async submitPunchRedemption(input: {
        redemptionRequestId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission> {
        const existing = await findTransactionByIdempotencyKey(
            input.idempotencyKey,
        );
        if (existing)
            return { transactionId: existing.id, status: existing.status };
        try {
            return await db.transaction(async (tx) => {
                const request = await findRedemptionRequestById(
                    input.redemptionRequestId,
                    tx,
                );
                if (!request) throw new ConsumerChainError("REQUEST_NOT_FOUND");
                if (request.status !== "approved")
                    throw new ConsumerChainError("REQUEST_NOT_APPROVED");
                const already = await findTransactionByRedemptionRequestId(
                    tx,
                    request.id,
                );
                if (already)
                    return {
                        transactionId: already.id,
                        status: already.status,
                    };
                const row = await createTransaction(tx, {
                    operation: "punch_redemption",
                    consumerUserId: request.consumerUserId,
                    cafeId: request.cafeId,
                    redemptionRequestId: request.id,
                    proofId: null,
                    chainTxId: `mock_${crypto.randomUUID()}`,
                    status: "pending",
                    idempotencyKey: input.idempotencyKey,
                    rejectionReason: null,
                });
                return { transactionId: row.id, status: row.status };
            });
        } catch (cause) {
            const byKey = await findTransactionByIdempotencyKey(
                input.idempotencyKey,
            );
            if (byKey) return { transactionId: byKey.id, status: byKey.status };
            const byRequest = await findTransactionByRedemptionRequestId(
                db,
                input.redemptionRequestId,
            );
            if (byRequest)
                return {
                    transactionId: byRequest.id,
                    status: byRequest.status,
                };
            throw cause;
        }
    }

    async submitVoucherRedemption(input: {
        redemptionRequestId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission> {
        const existing = await findTransactionByIdempotencyKey(
            input.idempotencyKey,
        );
        if (existing)
            return { transactionId: existing.id, status: existing.status };
        try {
            return await db.transaction(async (tx) => {
                const request = await findRedemptionRequestById(
                    input.redemptionRequestId,
                    tx,
                );
                if (!request) throw new ConsumerChainError("REQUEST_NOT_FOUND");
                if (
                    request.kind !== "voucher" ||
                    request.status !== "approved" ||
                    !request.voucherId
                ) {
                    throw new ConsumerChainError("REQUEST_NOT_APPROVED");
                }
                const already = await findTransactionByRedemptionRequestId(
                    tx,
                    request.id,
                );
                if (already)
                    return {
                        transactionId: already.id,
                        status: already.status,
                    };
                const row = await createTransaction(tx, {
                    operation: "voucher_redemption",
                    consumerUserId: request.consumerUserId,
                    cafeId: request.cafeId,
                    redemptionRequestId: request.id,
                    proofId: null,
                    chainTxId: `mock_${crypto.randomUUID()}`,
                    status: "pending",
                    idempotencyKey: input.idempotencyKey,
                    rejectionReason: null,
                    modeledHostPayoutCentimos: null,
                });
                return { transactionId: row.id, status: row.status };
            });
        } catch (cause) {
            const byKey = await findTransactionByIdempotencyKey(
                input.idempotencyKey,
            );
            if (byKey) return { transactionId: byKey.id, status: byKey.status };
            const byRequest = await findTransactionByRedemptionRequestId(
                db,
                input.redemptionRequestId,
            );
            if (byRequest)
                return {
                    transactionId: byRequest.id,
                    status: byRequest.status,
                };
            throw cause;
        }
    }
}
