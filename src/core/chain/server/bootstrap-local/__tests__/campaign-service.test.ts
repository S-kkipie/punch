import { describe, expect, it, vi } from "vitest";
import {
    bootstrapDemoCampaign,
    type DemoCampaignChain,
    type DemoCampaignRepository,
    decodeCampaignStatus,
} from "../service";

const address = (n: string) => `0x${n.padStart(40, "0")}` as `0x${string}`;
const owner = address("101");

function fixture(
    existing: {
        chainCampaignId: number | null;
        voucherPayout: bigint | null;
        maxVouchers: number | null;
        windowEnd: Date;
    } | null = null,
    ownerWalletIndex = 4,
) {
    const fixtureOwner = ownerWalletIndex === 123 ? address("123") : owner;
    let campaign = existing
        ? { id: "campaign-1", cafeId: "cafe-1", ...existing }
        : null;
    const calls: string[] = [];
    let minted = 0n;
    let funded = 0n;
    let approved = 0n;
    let published = false;
    let publishedExpiry = 0n;
    const repository: DemoCampaignRepository = {
        findCafeForCampaign: vi.fn(async () => ({
            id: "cafe-1",
            slug: "esquina-sur",
            chainCafeId: 7,
            ownerWalletIndex,
            ownerWalletAddress: fixtureOwner,
            campaign,
        })),
        insertDemoCampaign: vi.fn(
            async ({ cafeId, values, voucherPayout, maxVouchers }) => {
                campaign = {
                    id: "campaign-1",
                    cafeId,
                    chainCampaignId: null,
                    voucherPayout,
                    maxVouchers,
                    windowEnd: values.windowEnd,
                };
                calls.push("insert");
                return campaign;
            },
        ),
        linkCampaign: vi.fn(async ({ chainCampaignId }) => {
            calls.push("link");
            if (!campaign) throw new Error("campaign missing");
            campaign.chainCampaignId = chainCampaignId;
        }),
    };
    const chain: DemoCampaignChain = {
        addresses: { campaignEscrow: address("999"), mockPEN: address("998") },
        inspectCampaign: vi.fn(async () => ({
            sourceCafeId: 7n,
            budget: funded,
            voucherPayout: published ? 5_000_000n : 0n,
            maxVouchers: published ? 10n : 0n,
            expiry: published ? publishedExpiry : 0n,
            status: published ? ("published" as const) : ("draft" as const),
        })),
        ownerBalance: vi.fn(async () => minted),
        allowance: vi.fn(async () => approved),
        opsAddress: address("1"),
        deployerAddress: address("2"),
        ownerAddressForIndex: vi.fn(() => fixtureOwner),
        mint: vi.fn(async ({ amount }) => {
            calls.push("mint");
            minted += amount;
        }),
        createCampaign: vi.fn(async () => {
            calls.push("create");
            return {
                receipt: {
                    status: "success" as const,
                    logs: [] as readonly unknown[],
                },
                hash: "0x1" as `0x${string}`,
            };
        }),
        parseCreatedCampaignId: vi.fn(() => 12n),
        approve: vi.fn(async ({ amount }) => {
            calls.push("approve");
            approved = amount;
        }),
        fundCampaign: vi.fn(async ({ amount }) => {
            calls.push("fund");
            funded += amount;
        }),
        publishCampaign: vi.fn(async ({ expiry }) => {
            calls.push("publish");
            publishedExpiry = expiry;
            published = true;
        }),
    };
    return { repository, chain, calls, campaign: () => campaign };
}

const run = (f: ReturnType<typeof fixture>) =>
    bootstrapDemoCampaign({
        repository: f.repository,
        chain: f.chain,
        cafeSlug: "esquina-sur",
    });

describe("decodeCampaignStatus", () => {
    it.each([
        [0, "missing"],
        [1, "draft"],
        [2, "published"],
        [3, "cancelled"],
        [99, "missing"],
    ] as const)("decodes Solidity status %s as %s", (raw, expected) => {
        expect(decodeCampaignStatus(raw)).toBe(expected);
    });
});

describe("bootstrapDemoCampaign", () => {
    it("inserts and performs exact ordered writes with exact signers and values", async () => {
        const f = fixture();
        await run(f);
        expect(f.calls).toEqual([
            "insert",
            "mint",
            "create",
            "link",
            "approve",
            "fund",
            "publish",
        ]);
        expect(f.chain.mint).toHaveBeenCalledWith({
            to: owner,
            amount: 50_000_000n,
            signer: address("2"),
        });
        expect(f.chain.createCampaign).toHaveBeenCalledWith({
            sourceCafeId: 7n,
            signer: address("1"),
        });
        expect(f.chain.approve).toHaveBeenCalledWith({
            spender: address("999"),
            amount: 50_000_000n,
            signer: owner,
            ownerWalletIndex: 4,
        });
        expect(f.chain.fundCampaign).toHaveBeenCalledWith({
            campaignId: 12n,
            amount: 50_000_000n,
            signer: owner,
            ownerWalletIndex: 4,
        });
        expect(f.chain.publishCampaign).toHaveBeenCalledWith(
            expect.objectContaining({
                campaignId: 12n,
                voucherPayout: 5_000_000n,
                maxVouchers: 10n,
                signer: address("1"),
            }),
        );
    });

    it("does zero writes on the successful second run", async () => {
        const f = fixture();
        await run(f);
        vi.mocked(f.repository.findCafeForCampaign).mockResolvedValue({
            id: "cafe-1",
            slug: "esquina-sur",
            chainCafeId: 7,
            ownerWalletIndex: 4,
            ownerWalletAddress: owner,
            campaign: f.campaign(),
        });
        const count = f.calls.length;
        await run(f);
        expect(f.calls).toHaveLength(count);
        expect(f.repository.insertDemoCampaign).toHaveBeenCalledTimes(1);
        expect(f.repository.linkCampaign).toHaveBeenCalledTimes(1);
    });

    it("resumes an unlinked intent without inserting and uses persisted values", async () => {
        const f = fixture({
            chainCampaignId: null,
            voucherPayout: 9n,
            maxVouchers: 3,
            windowEnd: new Date("2030-01-01T00:00:00Z"),
        });
        await run(f);
        expect(f.repository.insertDemoCampaign).not.toHaveBeenCalled();
        expect(f.chain.mint).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 27n }),
        );
        expect(f.chain.publishCampaign).toHaveBeenCalledWith(
            expect.objectContaining({
                voucherPayout: 9n,
                maxVouchers: 3n,
                expiry: 1893456000n,
            }),
        );
    });

    it("retries after approve failure from the linked draft without recreating it", async () => {
        const f = fixture();
        vi.mocked(f.chain.approve).mockImplementationOnce(async () => {
            f.calls.push("approve");
            throw new Error("approve");
        });

        await expect(run(f)).rejects.toThrow("approve");
        await run(f);

        expect(f.calls).toEqual([
            "insert",
            "mint",
            "create",
            "link",
            "approve",
            "approve",
            "fund",
            "publish",
        ]);
        expect(f.chain.mint).toHaveBeenCalledTimes(1);
        expect(f.chain.createCampaign).toHaveBeenCalledTimes(1);
        expect(f.repository.linkCampaign).toHaveBeenCalledTimes(1);
        expect(f.chain.fundCampaign).toHaveBeenCalledTimes(1);
        expect(f.chain.publishCampaign).toHaveBeenCalledTimes(1);
    });

    it("retries after fund failure with the retained allowance", async () => {
        const f = fixture();
        vi.mocked(f.chain.fundCampaign).mockImplementationOnce(async () => {
            f.calls.push("fund");
            throw new Error("fund");
        });

        await expect(run(f)).rejects.toThrow("fund");
        await run(f);

        expect(f.calls).toEqual([
            "insert",
            "mint",
            "create",
            "link",
            "approve",
            "fund",
            "fund",
            "publish",
        ]);
        expect(f.chain.mint).toHaveBeenCalledTimes(1);
        expect(f.chain.createCampaign).toHaveBeenCalledTimes(1);
        expect(f.repository.linkCampaign).toHaveBeenCalledTimes(1);
        expect(f.chain.approve).toHaveBeenCalledTimes(1);
        expect(f.chain.publishCampaign).toHaveBeenCalledTimes(1);
    });

    it("retries after publish failure when the campaign is already funded", async () => {
        const f = fixture();
        vi.mocked(f.chain.publishCampaign).mockImplementationOnce(async () => {
            f.calls.push("publish");
            throw new Error("publish");
        });

        await expect(run(f)).rejects.toThrow("publish");
        await run(f);

        expect(f.calls).toEqual([
            "insert",
            "mint",
            "create",
            "link",
            "approve",
            "fund",
            "publish",
            "publish",
        ]);
        expect(f.chain.mint).toHaveBeenCalledTimes(1);
        expect(f.chain.createCampaign).toHaveBeenCalledTimes(1);
        expect(f.repository.linkCampaign).toHaveBeenCalledTimes(1);
        expect(f.chain.approve).toHaveBeenCalledTimes(1);
        expect(f.chain.fundCampaign).toHaveBeenCalledTimes(1);
        expect(f.chain.publishCampaign).toHaveBeenCalledTimes(2);
    });

    it("passes owner wallet index 123 directly to derivation and owner writes", async () => {
        const f = fixture(null, 123);

        await run(f);

        expect(f.chain.ownerAddressForIndex).toHaveBeenCalledWith(123);
        expect(f.chain.approve).toHaveBeenCalledWith(
            expect.objectContaining({ ownerWalletIndex: 123 }),
        );
        expect(f.chain.fundCampaign).toHaveBeenCalledWith(
            expect.objectContaining({ ownerWalletIndex: 123 }),
        );
    });

    it.each([
        "mint",
        "approve",
        "fund",
        "publish",
    ] as const)("stops after %s failure", async (operation) => {
        const f = fixture();
        const method =
            operation === "fund"
                ? f.chain.fundCampaign
                : operation === "mint"
                  ? f.chain.mint
                  : operation === "approve"
                    ? f.chain.approve
                    : f.chain.publishCampaign;
        vi.mocked(method).mockRejectedValueOnce(new Error(operation));
        await expect(run(f)).rejects.toThrow(operation);
        const next = {
            mint: ["insert"],
            approve: ["insert", "mint", "create", "link"],
            fund: ["insert", "mint", "create", "link", "approve"],
            publish: ["insert", "mint", "create", "link", "approve", "fund"],
        } as const;
        expect(f.calls).toEqual(next[operation]);
    });

    it("stops after reverted, missing-event, or overflowing create", async () => {
        for (const result of [
            { status: "reverted" as const, logs: [] as readonly unknown[] },
            { status: "success" as const, logs: [] as readonly unknown[] },
        ]) {
            const f = fixture();
            vi.mocked(f.chain.createCampaign).mockResolvedValue({
                receipt: result,
            });
            if (result.status === "success")
                vi.mocked(f.chain.parseCreatedCampaignId).mockReturnValue(null);
            await expect(run(f)).rejects.toThrow();
            expect(f.repository.linkCampaign).not.toHaveBeenCalled();
            expect(f.chain.approve).not.toHaveBeenCalled();
        }
        const f = fixture();
        vi.mocked(f.chain.parseCreatedCampaignId).mockReturnValue(
            2_147_483_648n,
        );
        await expect(run(f)).rejects.toThrow(/invalid campaign id/);
        expect(f.repository.linkCampaign).not.toHaveBeenCalled();
    });

    it("fails before writes for missing café, chain id, owner wallet, and mismatch", async () => {
        const cases = [
            null,
            {
                id: "cafe-1",
                slug: "esquina-sur",
                chainCafeId: null,
                ownerWalletIndex: 4,
                ownerWalletAddress: owner,
                campaign: null,
            },
            {
                id: "cafe-1",
                slug: "esquina-sur",
                chainCafeId: 7,
                ownerWalletIndex: null,
                ownerWalletAddress: null,
                campaign: null,
            },
            {
                id: "cafe-1",
                slug: "esquina-sur",
                chainCafeId: 7,
                ownerWalletIndex: 4,
                ownerWalletAddress: address("404"),
                campaign: null,
            },
        ];
        for (const cafe of cases) {
            const f = fixture();
            vi.mocked(f.repository.findCafeForCampaign).mockResolvedValue(cafe);
            await expect(run(f)).rejects.toThrow();
            expect(f.chain.mint).not.toHaveBeenCalled();
        }
    });
});
