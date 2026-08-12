import { describe, expect, it, vi } from "vitest";
import { abis } from "@/core/chain/abis";
import { campaignCancelHandler } from "../campaign-cancel";

const address = "0x0000000000000000000000000000000000000011" as const;
const job = (payload: unknown) => ({ payload }) as never;
const payload = { campaignId: "campaign-1", chainCampaignId: 7 };

const context = (status: number) =>
    ({
        addresses: { campaignEscrow: address },
        pub: { readContract: vi.fn(async () => ({ status })) },
    }) as never;

describe("campaignCancelHandler", () => {
    it("signs with ops, because cancelling is onlyOwner on the escrow", () => {
        expect(campaignCancelHandler.signer(job(payload))).toEqual({
            kind: "ops",
        });
    });

    it("calls cancelUnpublishedCampaign with the chain id", async () => {
        await expect(
            campaignCancelHandler.call(job(payload), context(1)),
        ).resolves.toEqual({
            address,
            abi: abis.campaignEscrow,
            functionName: "cancelUnpublishedCampaign",
            args: [7n],
        });
    });

    it("passes preflight while the campaign is still a draft", async () => {
        await expect(
            campaignCancelHandler.preflight?.(job(payload), context(1)),
        ).resolves.toBeNull();
    });

    it("stops before sending a transaction that would revert", async () => {
        // 2 = Published. El contrato rechaza cancelarla, así que no vale la
        // pena gastar una transacción para descubrirlo.
        await expect(
            campaignCancelHandler.preflight?.(job(payload), context(2)),
        ).resolves.toMatchObject({ code: "not_draft" });
    });

    it("rejects a payload it cannot trust", async () => {
        await expect(
            campaignCancelHandler.call(
                job({ campaignId: "only-this" }),
                context(1),
            ),
        ).rejects.toThrow("invalid payload");
    });
});
