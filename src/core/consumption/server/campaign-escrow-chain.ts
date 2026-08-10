import "server-only";

import { eq } from "drizzle-orm";
import { isAddress } from "viem";
import {
    enqueueJob,
    type JobTransaction,
} from "@/core/chain/server/relayer/job-repository";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { redemptionRequest } from "@/server/drizzle/schemas/consumption-schema";
import {
    campaign,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";
import type { ChainSubmission, ConsumerChainPort } from "./chain-port";
import { ConsumerChainError } from "./chain-port";

function statusOf(job: {
    status: "pending" | "submitted" | "confirmed" | "failed";
}) {
    return job.status === "submitted" ? "pending" : job.status;
}

export class CampaignEscrowChain implements ConsumerChainPort {
    async submitVoucherRedemption(input: {
        redemptionRequestId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission> {
        void input.idempotencyKey;
        const idempotencyKey = `voucher_redeem:${input.redemptionRequestId}`;
        return db.transaction(async (tx) => {
            const [existingJob] = await tx
                .select()
                .from(relayerJob)
                .where(eq(relayerJob.idempotencyKey, idempotencyKey));
            if (existingJob)
                return {
                    transactionId: existingJob.id,
                    status: statusOf(existingJob),
                };

            const [request] = await tx
                .select()
                .from(redemptionRequest)
                .where(eq(redemptionRequest.id, input.redemptionRequestId));
            if (!request) throw new ConsumerChainError("REQUEST_NOT_FOUND");
            if (
                request.kind !== "voucher" ||
                request.status !== "approved" ||
                !request.voucherId
            ) {
                throw new ConsumerChainError("REQUEST_NOT_APPROVED");
            }

            const [voucher] = await tx
                .select()
                .from(consumerVoucher)
                .where(eq(consumerVoucher.id, request.voucherId));
            if (!voucher) throw new ConsumerChainError("REQUEST_NOT_FOUND");
            if (
                voucher.source !== "campaign" ||
                voucher.status !== "available" ||
                !voucher.campaignId
            ) {
                throw new ConsumerChainError("REQUEST_NOT_APPROVED");
            }

            const [linkedCampaign] = await tx
                .select()
                .from(campaign)
                .where(eq(campaign.id, voucher.campaignId));
            if (!linkedCampaign)
                throw new ConsumerChainError("REQUEST_NOT_FOUND");
            if (linkedCampaign.chainCampaignId === null) {
                throw new ConsumerChainError("REQUEST_NOT_APPROVED");
            }

            const [consumer] = await tx
                .select({ walletAddress: user.walletAddress })
                .from(user)
                .where(eq(user.id, request.consumerUserId));
            const userAddress = consumer?.walletAddress?.trim().toLowerCase();
            if (!userAddress || !isAddress(userAddress))
                throw new ConsumerChainError("REQUEST_NOT_APPROVED");

            const payload = {
                chainCampaignId: linkedCampaign.chainCampaignId,
                userAddress,
                redemptionRequestId: request.id,
                voucherId: voucher.id,
                campaignId: linkedCampaign.id,
            };
            const created = await enqueueJob(tx as JobTransaction, {
                kind: "voucher_redeem",
                idempotencyKey,
                payload,
            });
            const job =
                created ??
                (
                    await tx
                        .select()
                        .from(relayerJob)
                        .where(eq(relayerJob.idempotencyKey, idempotencyKey))
                )[0];
            if (!job) throw new Error("voucher redemption job unavailable");
            return { transactionId: job.id, status: statusOf(job) };
        });
    }

    async submitConsumption(): Promise<never> {
        throw new ConsumerChainError("UNSUPPORTED_OPERATION");
    }

    async submitPunchRedemption(): Promise<never> {
        throw new ConsumerChainError("UNSUPPORTED_OPERATION");
    }

    async getTransactionStatus(): Promise<never> {
        throw new ConsumerChainError("UNSUPPORTED_OPERATION");
    }

    async getPunchBalance(): Promise<never> {
        throw new ConsumerChainError("UNSUPPORTED_OPERATION");
    }
}
