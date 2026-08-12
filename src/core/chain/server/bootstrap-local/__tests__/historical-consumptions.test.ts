import { describe, expect, it } from "vitest";
import {
    assertLocalChain31337,
    buildHistoricalSchedule,
} from "../historical-consumptions";

describe("historical consumption bootstrap", () => {
    it("rejects a non-local chain before demo seeding", async () => {
        await expect(
            assertLocalChain31337({ getChainId: async () => 421614 }),
        ).rejects.toThrow("demo seeding requires chain id 31337");
    });

    it("builds eleven deterministic approved emissions excluding the target cafe", () => {
        const schedule = buildHistoricalSchedule({
            cafes: [
                {
                    id: "cafe-a",
                    emissionProducts: [
                        { chainProductId: 11n, productId: "prod-a" },
                    ],
                },
                {
                    id: "cafe-b",
                    emissionProducts: [
                        { chainProductId: 12n, productId: "prod-b" },
                    ],
                },
                {
                    id: "target",
                    emissionProducts: [
                        { chainProductId: 13n, productId: "prod-target" },
                    ],
                },
            ],
            targetCafeId: "target",
            count: 11,
        });

        expect(schedule).toHaveLength(11);
        expect(new Set(schedule.map((item) => item.nonce)).size).toBe(11);
        expect(schedule.every((item) => item.cafeId !== "target")).toBe(true);
        expect(
            schedule.every(
                (item) =>
                    item.chainProductId === 11n || item.chainProductId === 12n,
            ),
        ).toBe(true);
        expect(
            schedule.every(
                (item) =>
                    item.productId === "prod-a" || item.productId === "prod-b",
            ),
        ).toBe(true);
        const perDay = new Map<string, number>();
        for (const item of schedule) {
            const key = `${item.cafeId}:${item.utcDay}`;
            perDay.set(key, (perDay.get(key) ?? 0) + 1);
        }
        expect(Math.max(...perDay.values())).toBeLessThanOrEqual(3);
        expect(schedule.every((item) => item.amount >= 8_000_000n)).toBe(true);
    });
});
