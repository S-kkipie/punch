import "server-only";
import { and, eq } from "drizzle-orm";
import { type DbClient, db } from "@/server/drizzle/db";
import {
    type ConsumerVoucherRow,
    coffeeCrawlStep,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";

export async function findVoucherById(
    id: string,
    client: DbClient = db,
): Promise<ConsumerVoucherRow | null> {
    const [row] = await client
        .select()
        .from(consumerVoucher)
        .where(eq(consumerVoucher.id, id));
    return row ?? null;
}

/** Verify the café is the campaign café or participates in the voucher's crawl. */
export async function isVoucherEligibleAtCafe(
    voucher: ConsumerVoucherRow,
    cafeId: string,
    client: DbClient = db,
): Promise<boolean> {
    if (voucher.source === "campaign") return voucher.cafeId === cafeId;
    if (!voucher.crawlId) return false;
    const [step] = await client
        .select({ id: coffeeCrawlStep.id })
        .from(coffeeCrawlStep)
        .where(
            and(
                eq(coffeeCrawlStep.crawlId, voucher.crawlId),
                eq(coffeeCrawlStep.cafeId, cafeId),
            ),
        );
    return Boolean(step);
}

/** Only succeeds when the voucher is still available: redeemed exactly once. */
export async function markVoucherRedeemed(
    client: DbClient,
    id: string,
): Promise<ConsumerVoucherRow> {
    const [row] = await client
        .update(consumerVoucher)
        .set({ status: "redeemed", redeemedAt: new Date() })
        .where(
            and(
                eq(consumerVoucher.id, id),
                eq(consumerVoucher.status, "available"),
            ),
        )
        .returning();
    if (!row) throw new Error("markVoucherRedeemed: voucher not available");
    return row;
}
