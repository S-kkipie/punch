import { describe, expect, it, vi } from "vitest";
import { abis } from "@/core/chain/abis";
import { voucherUnlockHandler } from "../voucher-unlock";

const job = (payload: unknown) => ({ payload }) as never;
const address = "0x0000000000000000000000000000000000000011" as const;

function context(overrides: Record<string, unknown> = {}) {
    return {
        addresses: { campaignEscrow: address },
        pub: {
            readContract: vi.fn(
                async ({ functionName }: { functionName: string }) =>
                    functionName === "paused"
                        ? false
                        : {
                              unlockedCount: 1n,
                              maxVouchers: 10n,
                              expiry: 2_000n,
                              status: 2,
                          },
            ),
            getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
            ...overrides,
        },
    } as never;
}

const payload = {
    chainCampaignId: 3,
    userAddress: "0xAbC",
    effectId: "effect-1",
};

describe("voucherUnlockHandler", () => {
    it("uses the relayer and exact unlock call", async () => {
        expect(voucherUnlockHandler.signer(job(payload))).toEqual({
            kind: "relayer",
        });
        const call = await voucherUnlockHandler.call(job(payload), context());
        expect(call).toEqual({
            address,
            abi: abis.campaignEscrow,
            functionName: "unlockVoucher",
            args: [3n, "0xAbC"],
        });
    });

    it.each([
        ["paused", { paused: true }, "paused"],
        ["non-published", { status: 1 }, "not_published"],
        [
            "cap reached",
            { unlockedCount: 10n, maxVouchers: 10n },
            "max_vouchers_reached",
        ],
        ["chain-time expiry", { expiry: 999n }, "campaign_expired"],
    ])("preflight rejects %s", async (_name, campaign, code) => {
        const values = campaign as {
            paused?: boolean;
            unlockedCount?: bigint;
            maxVouchers?: bigint;
            expiry?: bigint;
            status?: number;
        };
        const pub = {
            readContract: vi.fn(
                async ({ functionName }: { functionName: string }) =>
                    functionName === "paused"
                        ? (values.paused ?? false)
                        : {
                              unlockedCount: values.unlockedCount ?? 1n,
                              maxVouchers: values.maxVouchers ?? 10n,
                              expiry: values.expiry ?? 2_000n,
                              status: values.status ?? 2,
                          },
            ),
            getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
        };
        const failure = await voucherUnlockHandler.preflight?.(job(payload), {
            addresses: { campaignEscrow: address },
            pub,
        } as never);
        expect(failure?.code).toBe(code);
    });

    it("allows a published, unexpired campaign", async () => {
        await expect(
            voucherUnlockHandler.preflight?.(job(payload), context()),
        ).resolves.toBeNull();
    });

    it("marks voucher_already_unlocked idempotent", () => {
        expect(
            voucherUnlockHandler.idempotentCodes?.has(
                "voucher_already_unlocked",
            ),
        ).toBe(true);
    });

    it.each([
        ["max_vouchers_reached", "campaña agotada"],
        ["campaign_expired", "campaña vencida"],
        ["not_published", null],
    ] as const)("onFailed writes %s user-facing reason", async (code, reason) => {
        const update = vi.fn(() => ({
            set: vi.fn(() => ({ where: vi.fn() })),
        }));
        const effect = voucherUnlockHandler.onFailed?.(job(payload), {
            code,
            message: code,
        });
        expect(effect).toBeTypeOf("function");
        await effect?.({ update } as never, job(payload));
        expect(update).toHaveBeenCalled();
        expect(update.mock.results[0]?.value.set).toHaveBeenCalledWith({
            failureReason: reason,
        });
    });
});
