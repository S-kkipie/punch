import { and, eq } from "drizzle-orm";
import { abis } from "@/core/chain/abis";
import { chainPurchaseEffect } from "@/server/drizzle/schemas/punch-schema";
import type { JobHandler } from "./types";

type Payload = {
    chainCampaignId: number;
    userAddress: string;
    effectId: string;
};

function payloadOf(job: { payload: unknown }): Payload {
    const value = job.payload as Partial<Payload>;
    if (
        typeof value?.chainCampaignId !== "number" ||
        !Number.isSafeInteger(value.chainCampaignId) ||
        typeof value?.userAddress !== "string" ||
        typeof value?.effectId !== "string"
    ) {
        throw new Error("invalid payload");
    }
    return value as Payload;
}

export const voucherUnlockHandler: JobHandler = {
    kind: "voucher_unlock",
    signer: () => ({ kind: "relayer" }),
    async call(job, ctx) {
        const payload = payloadOf(job);
        return {
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "unlockVoucher",
            args: [BigInt(payload.chainCampaignId), payload.userAddress],
        };
    },
    async preflight(job, ctx) {
        const payload = payloadOf(job);
        const paused = await ctx.pub.readContract({
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "paused",
        });
        if (paused)
            return { code: "paused", message: "campaign escrow is paused" };
        const live = (await ctx.pub.readContract({
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "campaigns",
            args: [BigInt(payload.chainCampaignId)],
        })) as {
            unlockedCount: bigint;
            maxVouchers: bigint;
            expiry: bigint;
            status: number;
        };
        if (live.unlockedCount >= live.maxVouchers) {
            return {
                code: "max_vouchers_reached",
                message: "campaign voucher cap reached",
            };
        }
        const block = await ctx.pub.getBlock();
        if (block.timestamp > live.expiry) {
            return {
                code: "campaign_expired",
                message: "campaign has expired",
            };
        }
        if (live.status !== 2) {
            return {
                code: "not_published",
                message: "campaign is not published",
            };
        }
        return null;
    },
    idempotentCodes: new Set(["voucher_already_unlocked"]),
    onFailed(job, failure) {
        const { effectId } = payloadOf(job);
        const failureReason =
            failure.code === "max_vouchers_reached"
                ? "campaña agotada"
                : failure.code === "campaign_expired"
                  ? "campaña vencida"
                  : null;
        return async (tx) => {
            await tx
                .update(chainPurchaseEffect)
                .set({ failureReason })
                .where(
                    and(
                        eq(chainPurchaseEffect.id, effectId),
                        eq(chainPurchaseEffect.kind, "campaign_qualification"),
                    ),
                );
        };
    },
};
