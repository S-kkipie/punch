import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ conditions }),
    desc: (column: string) => ({ direction: "desc", column }),
    eq: (column: string, value: string) => ({ column, value }),
    inArray: (column: string, values: unknown[]) => ({ column, values }),
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

const pendingRequests = [
    {
        id: "request-pending",
        consumerUserId: "consumer-a",
        kind: "punch_reward",
        cafeId: "cafe-1",
        cafeName: "Brújula Café",
        productName: "Café gratis",
        campaignName: null,
        crawlName: null,
        createdAt: new Date("2026-08-08T14:00:00Z"),
    },
    {
        id: "request-other-consumer",
        consumerUserId: "consumer-b",
        kind: "punch_reward",
        cafeId: "cafe-2",
        cafeName: null,
        productName: null,
        campaignName: null,
        crawlName: null,
        createdAt: new Date("2026-08-08T15:00:00Z"),
    },
];

const mine = <T extends { consumerUserId: string; createdAt: Date }>(
    source: T[],
) =>
    source
        .filter((row) => row.consumerUserId === "consumer-a")
        .sort(
            (left, right) =>
                right.createdAt.getTime() - left.createdAt.getTime(),
        );

const where = vi.fn();
const join = (result: () => unknown) => {
    const query = {
        leftJoin: vi.fn(),
        where: vi.fn((...args: unknown[]) => {
            where(...args);
            return { orderBy: vi.fn(async () => result()) };
        }),
    };
    query.leftJoin.mockReturnValue(query);
    return query;
};

let selectCall = 0;

vi.mock("@/server/drizzle/db", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => {
                selectCall += 1;
                return selectCall === 1
                    ? join(() => mine(rows))
                    : join(() => mine(pendingRequests));
            }),
        })),
    },
}));

import { listHistoryService } from "../list-history-service";

describe("listHistoryService", () => {
    beforeEach(() => {
        selectCall = 0;
        where.mockClear();
    });

    it("filters by consumer and returns newest entries first", async () => {
        const result = await listHistoryService("consumer-a");

        expect(where).toHaveBeenCalled();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.map((entry) => entry.id)).toEqual([
                "request-pending",
                "tx-new",
                "tx-old",
            ]);
            expect(result.data[1]).toEqual(
                expect.objectContaining({
                    operation: "punch_redemption",
                    createdAt: "2026-08-08T12:00:00.000Z",
                }),
            );
            expect(result.data[1]).not.toHaveProperty("consumerUserId");
            expect(result.data[2]).toMatchObject({
                purchaseOrderId: "order-chain",
                transactionHash: "0xchain",
                logIndex: 4,
            });
        }
    });

    it("shows a requested redemption that has no chain transaction yet", async () => {
        const result = await listHistoryService("consumer-a");

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data[0]).toMatchObject({
                id: "request-pending",
                operation: "punch_redemption",
                status: "pending",
                cafeName: "Brújula Café",
                productName: "Café gratis",
                transactionHash: null,
                logIndex: null,
            });
        }
    });
});
