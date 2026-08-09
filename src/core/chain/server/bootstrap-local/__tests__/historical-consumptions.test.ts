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
                { id: "cafe-a", emissionProductIds: [11n] },
                { id: "cafe-b", emissionProductIds: [12n] },
                { id: "target", emissionProductIds: [13n] },
            ],
            targetCafeId: "target",
            count: 11,
        });

        expect(schedule).toHaveLength(11);
        expect(new Set(schedule.map((item) => item.nonce)).size).toBe(11);
        expect(schedule.every((item) => item.cafeId !== "target")).toBe(true);
        expect(
            schedule.every(
                (item) => item.productId === 11n || item.productId === 12n,
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
