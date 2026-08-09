import { describe, expect, it } from "vitest";
import { applyCampaignEvent } from "../campaign-projection";

function fakeTx() {
    const calls: { table: string; values: unknown }[] = [];
    const chainable = {
        values: (v: unknown) => ({
            onConflictDoUpdate: () => {
                calls.push({ table: "insert", values: v });
                return Promise.resolve();
            },
            onConflictDoNothing: () => {
                calls.push({ table: "insert", values: v });
                return Promise.resolve();
            },
            returning: () => Promise.resolve([]),
        }),
        set: () => ({
            where: () => ({ returning: () => Promise.resolve([{}]) }),
        }),
        from: () => ({ where: () => Promise.resolve([]) }),
    };
    return {
        calls,
        tx: {
            insert: () => chainable,
            update: () => chainable,
            select: () => chainable,
        } as never,
    };
}

const base = {
    blockNumber: 10n,
    transactionHash: "0xabc",
    logIndex: 0,
    transactionIndex: 0,
};

describe("applyCampaignEvent", () => {
    it("creates a draft projection row on CampaignCreated", async () => {
        const { tx, calls } = fakeTx();
        await applyCampaignEvent(tx, {
            ...base,
            eventName: "CampaignCreated",
            args: { campaignId: 1n, sourceCafeId: 2n },
        });
        expect(calls[0]?.values).toMatchObject({
            chainCampaignId: 1,
            status: "draft",
            budget: 0n,
        });
    });

    it("rejects a campaign id that overflows a SQL integer", async () => {
        const { tx } = fakeTx();
        await expect(
            applyCampaignEvent(tx, {
                ...base,
                eventName: "CampaignCreated",
                args: { campaignId: 2n ** 40n, sourceCafeId: 1n },
            }),
        ).rejects.toThrow();
    });
});
