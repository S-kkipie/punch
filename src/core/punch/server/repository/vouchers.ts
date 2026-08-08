import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
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

export class VoucherRepositoryError extends Error {
    constructor(
        public readonly code: "NOT_AVAILABLE" | "EXPIRED",
        message: string,
    ) {
        super(message);
        this.name = "VoucherRepositoryError";
    }
}

/** Redeems exactly once, using PostgreSQL's clock as the expiry authority. */
export async function markVoucherRedeemed(
    client: DbClient,
    id: string,
): Promise<ConsumerVoucherRow> {
    const [row] = await client
        .update(consumerVoucher)
        .set({ status: "redeemed", redeemedAt: sql`CURRENT_TIMESTAMP` })
        .where(
            and(
                eq(consumerVoucher.id, id),
                eq(consumerVoucher.status, "available"),
                gt(consumerVoucher.expiresAt, sql`CURRENT_TIMESTAMP`),
            ),
        )
        .returning();
    if (row) return row;

    const [expired] = await client
        .select({ status: consumerVoucher.status })
        .from(consumerVoucher)
        .where(
            and(
                eq(consumerVoucher.id, id),
                eq(consumerVoucher.status, "available"),
                sql`${consumerVoucher.expiresAt} <= CURRENT_TIMESTAMP`,
            ),
        );
    if (expired) {
        throw new VoucherRepositoryError("EXPIRED", "El voucher ya venció.");
    }
    throw new VoucherRepositoryError(
        "NOT_AVAILABLE",
        "El voucher ya fue utilizado o no está disponible.",
    );
}

/** Atomically records expiry without changing redeemed vouchers. */
export async function markVoucherExpiredIfAvailable(
    client: DbClient,
    id: string,
): Promise<void> {
    await client
        .update(consumerVoucher)
        .set({ status: "expired" })
        .where(
            and(
                eq(consumerVoucher.id, id),
                eq(consumerVoucher.status, "available"),
                sql`${consumerVoucher.expiresAt} <= CURRENT_TIMESTAMP`,
            ),
        );
}
