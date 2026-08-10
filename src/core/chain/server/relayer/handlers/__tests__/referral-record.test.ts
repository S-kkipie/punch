import { describe, expect, it } from "vitest";
import { referralRecordHandler } from "../referral-record";

const job = (payload: unknown) => ({ id: "j1", payload }) as never;

describe("referralRecordHandler", () => {
    it("targets NetworkFund.recordReferralWithProof with exact args", async () => {
        const call = await referralRecordHandler.call(
            job({
                epoch: 202608,
                originCafeId: 3,
                referralId: `0x${"ab".repeat(32)}`,
            }),
            { addresses: { networkFund: "0xfund" } } as never,
        );
        expect(call.address).toBe("0xfund");
        expect(call.functionName).toBe("recordReferralWithProof");
        expect(call.args).toEqual([202608n, 3n, `0x${"ab".repeat(32)}`]);
    });

    it("signs as relayer and treats ReferralIdUsed as idempotent", () => {
        expect(referralRecordHandler.signer(job({}))).toEqual({
            kind: "relayer",
        });
        expect(
            referralRecordHandler.idempotentCodes?.has("referral_id_used"),
        ).toBe(true);
    });

    it("rejects malformed payloads", async () => {
        await expect(
            referralRecordHandler.call(job({ epoch: "x" }), {} as never),
        ).rejects.toThrow("invalid payload");
    });
});
