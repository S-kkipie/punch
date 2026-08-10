import { abis } from "@/core/chain/abis";
import type { JobHandler } from "./types";

type Payload = { epoch: number; originCafeId: number; referralId: string };

function payloadOf(job: { payload: unknown }): Payload {
    const value = job.payload as Partial<Payload>;
    if (
        typeof value?.epoch !== "number" ||
        !Number.isSafeInteger(value.epoch) ||
        typeof value?.originCafeId !== "number" ||
        !Number.isSafeInteger(value.originCafeId) ||
        typeof value?.referralId !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(value.referralId)
    ) {
        throw new Error("invalid payload");
    }
    return value as Payload;
}

export const referralRecordHandler: JobHandler = {
    kind: "referral_record",
    signer: () => ({ kind: "relayer" }),
    async call(job, ctx) {
        const payload = payloadOf(job);
        return {
            address: ctx.addresses.networkFund,
            abi: abis.networkFund,
            functionName: "recordReferralWithProof",
            args: [
                BigInt(payload.epoch),
                BigInt(payload.originCafeId),
                payload.referralId as `0x${string}`,
            ],
        };
    },
    idempotentCodes: new Set(["referral_id_used"]),
};
