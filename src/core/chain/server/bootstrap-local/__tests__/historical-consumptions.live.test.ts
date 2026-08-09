import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { seedHistoricalConsumptions } from "../historical-consumptions";

const live = process.env.PUNCH_RUN_LIVE_CHAIN === "1";

describe.skipIf(!live)("live historical consumption seeding", () => {
    it("seeds exactly eleven real PUNCH and refuses a second run", async () => {
        const [consumer] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, "demo-consumer@punch.pe"));
        const [targetCafe] = await db
            .select({ id: cafe.id })
            .from(cafe)
            .where(eq(cafe.slug, "esquina-sur"));
        if (!consumer || !targetCafe) {
            throw new Error("live test precondition missing: run db:seed first");
        }

        const receiptHashes = await seedHistoricalConsumptions({
            consumerUserId: consumer.id,
            count: 11,
            targetCafeId: targetCafe.id,
        });
        expect(receiptHashes).toHaveLength(11);
        expect(new Set(receiptHashes).size).toBe(11);
        await expect(
            seedHistoricalConsumptions({
                consumerUserId: consumer.id,
                count: 11,
                targetCafeId: targetCafe.id,
            }),
        ).rejects.toThrow(/already seeded/i);
    });
});
