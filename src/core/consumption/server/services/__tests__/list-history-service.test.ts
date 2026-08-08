import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/drizzle/db", () => ({
    db: {
        select: vi.fn(() => ({
            from: () => ({
                where: () => ({
                    orderBy: async () => [
                        {
                            id: "tx-2",
                            operation: "punch_redemption",
                            cafeId: "cafe-1",
                            status: "confirmed",
                            rejectionReason: null,
                            createdAt: new Date("2026-08-08T12:00:00Z"),
                        },
                    ],
                }),
            }),
        })),
    },
}));

import { listHistoryService } from "../list-history-service";

describe("listHistoryService", () => {
    it("returns consumer-safe entries newest first", async () => {
        const result = await listHistoryService("consumer-a");
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual([
                expect.objectContaining({
                    id: "tx-2",
                    operation: "punch_redemption",
                    createdAt: "2026-08-08T12:00:00.000Z",
                }),
            ]);
            expect(result.data[0]).not.toHaveProperty("consumerUserId");
        }
    });
});
