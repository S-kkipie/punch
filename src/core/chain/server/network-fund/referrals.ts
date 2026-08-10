import "server-only";

import { keccak256, toBytes } from "viem";
import {
    enqueueJob,
    type JobTransaction,
} from "@/core/chain/server/relayer/job-repository";
import { currentEpoch } from "./epoch";

export function referralKeyForVoucher(
    chainCampaignId: number,
    userAddress: string,
): string {
    return `voucher:${chainCampaignId}:${userAddress.toLowerCase()}`;
}

export function referralKeyForCrawl(
    consumerUserId: string,
    chainCafeA: number,
    chainCafeB: number,
): string {
    return `crawl:${consumerUserId}:${chainCafeA}:${chainCafeB}`;
}

export async function enqueueReferralRecord(
    tx: JobTransaction,
    input: {
        originChainCafeId: number;
        referralKey: string;
        epoch?: number;
    },
): Promise<void> {
    await enqueueJob(tx, {
        kind: "referral_record",
        idempotencyKey: `referral:${input.referralKey}`,
        payload: {
            epoch: input.epoch ?? currentEpoch(),
            originCafeId: input.originChainCafeId,
            referralId: keccak256(toBytes(input.referralKey)),
        },
    });
}
