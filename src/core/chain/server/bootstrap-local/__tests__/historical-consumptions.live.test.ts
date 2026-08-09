import { describe, expect, it } from "vitest";
import { seedHistoricalConsumptions } from "../historical-consumptions";

const live = process.env.PUNCH_RUN_LIVE_CHAIN === "1";

describe.skipIf(!live)("live historical consumption seeding", () => {
    it("seeds exactly eleven real PUNCH and refuses a second run", async () => {
        const receiptHashes = await seedHistoricalConsumptions({
            consumerUserId: "demo-consumer",
            count: 11,
            targetCafeId: "esquina-sur",
        });
        expect(receiptHashes).toHaveLength(11);
        await expect(
            seedHistoricalConsumptions({
                consumerUserId: "demo-consumer",
                count: 11,
                targetCafeId: "esquina-sur",
            }),
        ).rejects.toThrow(/already seeded/i);
    });
});
