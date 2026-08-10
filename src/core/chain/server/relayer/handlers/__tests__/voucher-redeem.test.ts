import { describe, expect, it } from "vitest";
import { abis } from "@/core/chain/abis";
import { voucherRedeemHandler } from "../voucher-redeem";

const address = "0x0000000000000000000000000000000000000011" as const;
const job = (payload: unknown) => ({ payload }) as never;

const payload = {
    chainCampaignId: 9007199254740991,
    userAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    redemptionRequestId: "request-1",
    voucherId: "voucher-1",
};

describe("voucherRedeemHandler", () => {
    it("uses the relayer and calls redeemVoucher with lossless campaign id", async () => {
        expect(voucherRedeemHandler.signer(job(payload))).toEqual({
            kind: "relayer",
        });
        await expect(
            voucherRedeemHandler.call(job(payload), {
                addresses: { campaignEscrow: address },
            } as never),
        ).resolves.toEqual({
            address,
            abi: abis.campaignEscrow,
            functionName: "redeemVoucher",
            args: [BigInt(payload.chainCampaignId), payload.userAddress],
        });
    });

    it("treats an already redeemed voucher as idempotent", () => {
        expect(
            voucherRedeemHandler.idempotentCodes?.has(
                "voucher_already_redeemed",
            ),
        ).toBe(true);
        expect(voucherRedeemHandler.idempotentOnChain).not.toBe(false);
    });

    it.each([
        { chainCampaignId: "3", userAddress: "0xAbC" },
        {
            chainCampaignId: 3,
            userAddress: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
            redemptionRequestId: "request-1",
            voucherId: "voucher-1",
        },
    ])("rejects malformed or non-normalized payloads", async (invalid) => {
        await expect(
            voucherRedeemHandler.call(job(invalid), {
                addresses: { campaignEscrow: address },
            } as never),
        ).rejects.toThrow("invalid payload");
    });
});
