import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
    desc: (column: string) => ({ direction: "desc", column }),
    eq: (column: string, value: string) => ({ column, value }),
}));
vi.mock("@/server/drizzle/schemas/consumption-schema", () => ({
    consumerTransaction: {
        consumerUserId: "consumerUserId",
        createdAt: "createdAt",
    },
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
    },
    {
        id: "tx-old",
        consumerUserId: "consumer-a",
        operation: "emission",
        cafeId: "cafe-1",
        status: "confirmed",
        rejectionReason: null,
        createdAt: new Date("2026-08-08T11:00:00Z"),
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

const where = vi.fn((condition: { column: string; value: string }) => ({
    orderBy: vi.fn(async (ordering: { direction: string; column: string }) =>
        rows
            .filter(
                (row) =>
                    row[condition.column as "consumerUserId"] ===
                    condition.value,
            )
            .sort((left, right) =>
                ordering.direction === "desc"
                    ? right.createdAt.getTime() - left.createdAt.getTime()
                    : left.createdAt.getTime() - right.createdAt.getTime(),
            ),
    ),
}));

vi.mock("@/server/drizzle/db", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({ where })),
        })),
    },
}));

import { listHistoryService } from "../list-history-service";

describe("listHistoryService", () => {
    it("filters by consumer and returns newest entries first", async () => {
        const result = await listHistoryService("consumer-a");

        expect(where).toHaveBeenCalledWith({
            column: "consumerUserId",
            value: "consumer-a",
        });
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
        }
    });
});
