// biome-ignore-all lint/suspicious/noExplicitAny: the fake transaction mirrors Drizzle's generic builder surface
import { describe, expect, it } from "vitest";
import {
    projectionCafeCredit,
    projectionConsumption,
    projectionPunchBalance,
} from "@/server/drizzle/schemas/chain-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import {
    applyEvent,
    CREDITS_PER_PURCHASE,
    type IndexerEvent,
} from "../apply-event";

type FakeState = {
    punchBalances: Map<string, { balance: bigint; lastBlock: bigint }>;
    cafeCredits: Map<number, { credits: bigint; lastBlock: bigint }>;
    consumptions: Map<
        string,
        { txHash: string; logIndex: number; block: bigint }
    >;
    orders: Array<{
        id: string;
        status:
            | "user_confirmed"
            | "cafe_confirmed"
            | "queued"
            | "submitted"
            | "confirmed"
            | "failed"
            | "expired";
        receiptHash: string;
        chainCafeId: number;
        userAddress: string;
        txHash: string | null;
    }>;
    lastConsumption: null | {
        chainCafeId: number;
        userAddress: string;
        receiptHash: string;
    };
};

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
    overrides: Partial<IndexerEvent> = {},
): IndexerEvent {
    return { ...base, eventName, args, ...overrides };
}

function fakeTx(seed: Partial<FakeState> = {}) {
    const state: FakeState = {
        punchBalances: new Map(),
        cafeCredits: new Map(),
        consumptions: new Map(),
        orders: [],
        lastConsumption: null,
        ...seed,
    };
    return {
        state,
        insert(table: unknown) {
            return {
                values(values: any) {
                    return {
                        onConflictDoUpdate() {
                            if (table === projectionPunchBalance) {
                                const current = state.punchBalances.get(
                                    values.userAddress,
                                );
                                state.punchBalances.set(values.userAddress, {
                                    balance: (current?.balance ?? 0n) + 1n,
                                    lastBlock:
                                        current?.lastBlock &&
                                        current.lastBlock > values.lastBlock
                                            ? current.lastBlock
                                            : values.lastBlock,
                                });
                            }
                            if (table === projectionCafeCredit) {
                                const current = state.cafeCredits.get(
                                    values.chainCafeId,
                                );
                                state.cafeCredits.set(values.chainCafeId, {
                                    credits:
                                        (current?.credits ?? 0n) +
                                        values.credits,
                                    lastBlock:
                                        current?.lastBlock &&
                                        current.lastBlock > values.lastBlock
                                            ? current.lastBlock
                                            : values.lastBlock,
                                });
                            }
                            return Promise.resolve();
                        },
                        onConflictDoNothing() {
                            if (table === projectionConsumption) {
                                const key = `${values.txHash}:${values.logIndex}`;
                                if (!state.consumptions.has(key)) {
                                    state.consumptions.set(key, {
                                        txHash: values.txHash,
                                        logIndex: values.logIndex,
                                        block: values.block,
                                    });
                                }
                                state.lastConsumption = {
                                    chainCafeId: values.chainCafeId,
                                    userAddress: values.userAddress,
                                    receiptHash: values.receiptHash,
                                };
                            }
                            return Promise.resolve();
                        },
                    };
                },
            };
        },
        update(table: unknown) {
            return {
                set(values: any) {
                    return {
                        where() {
                            if (table === purchaseOrder) {
                                const match = state.orders.find(
                                    (order) =>
                                        order.receiptHash ===
                                            state.lastConsumption
                                                ?.receiptHash &&
                                        order.chainCafeId ===
                                            state.lastConsumption
                                                ?.chainCafeId &&
                                        order.userAddress ===
                                            state.lastConsumption
                                                ?.userAddress &&
                                        [
                                            "user_confirmed",
                                            "cafe_confirmed",
                                            "queued",
                                            "submitted",
                                        ].includes(order.status),
                                );
                                if (match) {
                                    match.status = values.status;
                                    match.txHash = values.txHash;
                                }
                                return Promise.resolve([]);
                            }
                            return {
                                returning() {
                                    if (table === projectionCafeCredit) {
                                        const chainCafeId =
                                            state.lastConsumption
                                                ?.chainCafeId ?? -1;
                                        const record =
                                            state.cafeCredits.get(chainCafeId);
                                        if (!record || record.credits <= 0n) {
                                            return Promise.resolve([]);
                                        }
                                        record.credits -= 1n;
                                        record.lastBlock = 10n;
                                        return Promise.resolve([
                                            { chainCafeId },
                                        ]);
                                    }
                                    return Promise.resolve([]);
                                },
                            };
                        },
                    };
                },
            };
        },
        select() {
            return {
                from() {
                    return this;
                },
                innerJoin() {
                    return this;
                },
                where() {
                    const matches = state.lastConsumption
                        ? state.orders
                              .filter(
                                  (order) =>
                                      order.receiptHash ===
                                          state.lastConsumption?.receiptHash &&
                                      order.chainCafeId ===
                                          state.lastConsumption?.chainCafeId &&
                                      order.userAddress ===
                                          state.lastConsumption?.userAddress,
                              )
                              .map((order) => ({
                                  id: order.id,
                                  status: order.status,
                              }))
                        : [];
                    return Promise.resolve(matches);
                },
            };
        },
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
        await applyEvent(
            tx,
            event("PunchIssued", {
                user: "0x1111111111111111111111111111111111111111",
                cafeId: 1n,
            }),
        );

        expect(
            tx.state.punchBalances.get(
                "0x1111111111111111111111111111111111111111",
            ),
        ).toEqual({ balance: 2n, lastBlock: 10n });
    });

    it("credits exactly 100 on activation and another 100 on pack purchase", async () => {
        const tx = fakeTx();
        await applyEvent(tx, event("PlanActivated", { cafeId: 7n }));
        expect(tx.state.cafeCredits.get(7)).toEqual({
            credits: CREDITS_PER_PURCHASE,
            lastBlock: 10n,
        });

        await applyEvent(tx, event("PackPurchased", { cafeId: 7n }));

        expect(tx.state.cafeCredits.get(7)).toEqual({
            credits: 2n * CREDITS_PER_PURCHASE,
            lastBlock: 10n,
        });
    });

    it("records consumption idempotently and confirms matching orders", async () => {
        const tx = fakeTx({
            orders: [
                {
                    id: "order-1",
                    status: "queued",
                    receiptHash:
                        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    chainCafeId: 1,
                    userAddress: "0x1111111111111111111111111111111111111111",
                    txHash: null,
                },
            ],
        });
        const consumption = event("ConsumptionRecorded", {
            cafeId: 1n,
            user: "0x1111111111111111111111111111111111111111",
            receiptHash:
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        });

        await applyEvent(tx, consumption);
        await applyEvent(tx, consumption);

        expect(tx.state.consumptions.size).toBe(1);
        expect(tx.state.orders[0]).toMatchObject({
            status: "confirmed",
            txHash: consumption.transactionHash,
        });
    });

    it("rejects credit consumption before activation", async () => {
        await expect(
            applyEvent(
                fakeTx(),
                event("EmissionCreditConsumed", { cafeId: 3n }),
            ),
        ).rejects.toThrow("cannot consume credit for cafe 3 before activation");
    });

    it("rejects overflowing chain ids", async () => {
        await expect(
            applyEvent(
                fakeTx(),
                event("PackPurchased", { cafeId: 2_147_483_648n }),
            ),
        ).rejects.toThrow("overflows");
    });

    it("rejects overflowing log indexes", async () => {
        await expect(
            applyEvent(
                fakeTx(),
                event(
                    "ConsumptionRecorded",
                    {
                        cafeId: 1n,
                        user: "0x1111111111111111111111111111111111111111",
                        receiptHash:
                            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    },
                    { logIndex: 2_147_483_648 },
                ),
            ),
        ).rejects.toThrow("log index overflows SQL integer");
    });
});
