import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ conditions }),
    desc: (column: string) => ({ direction: "desc", column }),
    eq: (column: string, value: string) => ({ column, value }),
    sql: String.raw,
}));
const { table } = vi.hoisted(() => ({
    table: (prefix: string) =>
        new Proxy(
            {},
            { get: (_target, property) => `${prefix}.${String(property)}` },
        ),
}));
vi.mock("@/server/drizzle/schemas/consumption-schema", () => ({
    consumerTransaction: table("transaction"),
    consumptionProof: table("proof"),
    redemptionRequest: table("request"),
}));
vi.mock("@/server/drizzle/schemas/cafe-schema", () => ({
    cafe: table("cafe"),
    cafeProduct: table("product"),
}));
vi.mock("@/server/drizzle/schemas/punch-schema", () => ({
    campaign: table("campaign"),
    coffeeCrawl: table("crawl"),
    consumerVoucher: table("voucher"),
}));

const rows = [
    {
        id: "other-new",
        consumerUserId: "consumer-b",
        operation: "emission",
        cafeId: "cafe-2",
        status: "confirmed",
        rejectionReason: null,
        createdAt: new Date("2026-08-08T13:00:00Z"),
        purchaseOrderId: null,
        transactionHash: null,
        logIndex: null,
    },
    {
        id: "tx-old",
        consumerUserId: "consumer-a",
        operation: "emission",
        cafeId: "cafe-1",
        status: "confirmed",
        rejectionReason: null,
        createdAt: new Date("2026-08-08T11:00:00Z"),
        purchaseOrderId: "order-chain",
        transactionHash: "0xchain",
        logIndex: 4,
    },
    {
        id: "tx-new",
        consumerUserId: "consumer-a",
        operation: "punch_redemption",
        cafeId: "cafe-1",
        status: "confirmed",
        rejectionReason: null,
        createdAt: new Date("2026-08-08T12:00:00Z"),
    },
];

const where = vi.fn(() => ({
    orderBy: vi.fn(async () =>
        rows
            .filter((row) => row.consumerUserId === "consumer-a")
            .sort(
                (left, right) =>
                    right.createdAt.getTime() - left.createdAt.getTime(),
            ),
    ),
}));
const join = () => {
    const query = { leftJoin: vi.fn(), where };
    query.leftJoin.mockReturnValue(query);
    return query;
};

vi.mock("@/server/drizzle/db", () => ({
    db: {
        select: vi.fn(() => ({ from: vi.fn(() => join()) })),
    },
}));

import { listHistoryService } from "../list-history-service";

describe("listHistoryService", () => {
    it("filters by consumer and returns newest entries first", async () => {
        const result = await listHistoryService("consumer-a");

        expect(where).toHaveBeenCalled();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.map((entry) => entry.id)).toEqual([
                "tx-new",
                "tx-old",
            ]);
            expect(result.data[0]).toEqual(
                expect.objectContaining({
                    operation: "punch_redemption",
                    createdAt: "2026-08-08T12:00:00.000Z",
                }),
            );
            expect(result.data[0]).not.toHaveProperty("consumerUserId");
            expect(result.data[1]).toMatchObject({
                purchaseOrderId: "order-chain",
                transactionHash: "0xchain",
                logIndex: 4,
            });
        }
    });
});
