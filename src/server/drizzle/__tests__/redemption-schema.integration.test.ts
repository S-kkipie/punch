import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";

const run =
    process.env.PUNCH_RUN_INTEGRATION === "1" ? describe : describe.skip;

run("redemption schema", () => {
    it("relayer_job accepts a punch_redemption row without order_id", async () => {
        const result = await db.execute(sql`
            SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_name = 'relayer_job' AND column_name IN ('order_id', 'kind', 'redemption_request_id')
        `);
        const byName = Object.fromEntries(
            (
                result.rows as unknown as {
                    column_name: string;
                    is_nullable: string;
                }[]
            ).map((r) => [r.column_name, r.is_nullable]),
        );
        expect(byName.order_id).toBe("YES");
        expect(byName.kind).toBe("NO");
        expect(byName.redemption_request_id).toBe("YES");
    });

    it("redemption_request_status enum includes confirmed and failed", async () => {
        const result = await db.execute(sql`
            SELECT enumlabel FROM pg_enum
            JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
            WHERE pg_type.typname = 'redemption_request_status'
        `);
        const labels = (result.rows as unknown as { enumlabel: string }[]).map(
            (r) => r.enumlabel,
        );
        expect(labels).toContain("confirmed");
        expect(labels).toContain("failed");
    });

    it("projection_cafe_payout table exists", async () => {
        const result = await db.execute(sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'projection_cafe_payout'
        `);
        const names = (result.rows as unknown as { column_name: string }[]).map(
            (r) => r.column_name,
        );
        expect(names).toEqual(
            expect.arrayContaining([
                "cafe_id",
                "total_centimos",
                "redemption_count",
            ]),
        );
    });

    it("only one active punch_reward request per consumer", async () => {
        const result = await db.execute(sql`
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'redemption_request' AND indexname = 'redemption_request_active_punch_uq'
        `);
        expect(result.rows.length).toBe(1);
    });
});
