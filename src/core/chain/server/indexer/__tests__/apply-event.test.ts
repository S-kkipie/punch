// biome-ignore-all lint/suspicious/noExplicitAny: the fake transaction mirrors Drizzle's generic builder surface
import { describe, expect, it } from "vitest";
import {
    applyEvent,
    CREDITS_PER_PURCHASE,
    type IndexerEvent,
} from "../apply-event";

const base = {
    blockNumber: 10n,
    transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 0,
    transactionIndex: 0,
};
function event(
    eventName: IndexerEvent["eventName"],
    args: Record<string, unknown>,
): IndexerEvent {
    return { ...base, eventName, args };
}
function fakeTx() {
    const calls: Array<{ op: string; values?: unknown }> = [];
    const builder = (op: string) => ({
        values(v: unknown) {
            calls.push({ op, values: v });
            return this;
        },
        set(v: unknown) {
            calls.push({ op, values: v });
            return this;
        },
        onConflictDoUpdate(v: unknown) {
            calls.push({ op, values: v });
            return this;
        },
        onConflictDoNothing(v: unknown) {
            calls.push({ op, values: v });
            return this;
        },
        where() {
            return Promise.resolve([]);
        },
        from() {
            return this;
        },
        innerJoin() {
            return this;
        },
    });
    return {
        calls,
        insert: (_table: unknown) => {
            (calls as any).insertCalls = ((calls as any).insertCalls ?? 0) + 1;
            return builder("insert");
        },
        update: (_table: unknown) => builder("update"),
        select: () => builder("select"),
    } as any;
}

describe("applyEvent", () => {
    it("increments punch balance atomically", async () => {
        const tx = fakeTx();
        await applyEvent(
            tx,
            event("PunchIssued", {
                user: "0x1111111111111111111111111111111111111111",
                cafeId: 1n,
            }),
        );
        expect(
            tx.calls.some(
                (c: any) => c.op === "insert" && c.values.balance === 1n,
            ),
        ).toBe(true);
    });
    it("adds and consumes credits without read-modify-write", async () => {
        const tx = fakeTx();
        await applyEvent(tx, event("PlanActivated", { cafeId: 7n }));
        await applyEvent(tx, event("EmissionCreditConsumed", { cafeId: 7n }));
        expect(CREDITS_PER_PURCHASE).toBe(100n);
        expect((tx.calls as any).insertCalls).toBe(2);
    });
    it("deduplicates consumption by transaction and log index", async () => {
        const tx = fakeTx();
        const e = event("ConsumptionRecorded", {
            cafeId: 1n,
            user: "0x1111111111111111111111111111111111111111",
            receiptHash:
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        });
        await applyEvent(tx, e);
        await applyEvent(tx, e);
        expect((tx.calls as any).insertCalls).toBe(2);
        expect(
            tx.calls.some(
                (c: any) =>
                    c.op === "insert" && c.values?.txHash === e.transactionHash,
            ),
        ).toBe(true);
    });
    it("rejects overflowing chain ids", async () => {
        await expect(
            applyEvent(
                fakeTx(),
                event("PackPurchased", { cafeId: 2_147_483_648n }),
            ),
        ).rejects.toThrow("overflows");
    });
});
