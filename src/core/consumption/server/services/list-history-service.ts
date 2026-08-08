import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { type AsyncAppResult, ok } from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { cafe, cafeProduct } from "@/server/drizzle/schemas/cafe-schema";
import {
    consumerTransaction,
    consumptionProof,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";
import {
    campaign,
    coffeeCrawl,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";

export type HistoryEntry = {
    id: string;
    operation: "emission" | "punch_redemption" | "voucher_redemption";
    cafeId: string;
    cafeName: string | null;
    productName: string | null;
    campaignName: string | null;
    crawlName: string | null;
    status: "pending" | "confirmed" | "rejected" | "failed";
    rejectionReason: string | null;
    createdAt: string;
};

export async function listHistoryService(
    consumerUserId: string,
): AsyncAppResult<HistoryEntry[]> {
    const rows = await db
        .select({
            id: consumerTransaction.id,
            operation: consumerTransaction.operation,
            cafeId: consumerTransaction.cafeId,
            cafeName: cafe.name,
            productName: cafeProduct.name,
            campaignName: campaign.name,
            crawlName: coffeeCrawl.name,
            status: consumerTransaction.status,
            rejectionReason: consumerTransaction.rejectionReason,
            createdAt: consumerTransaction.createdAt,
        })
        .from(consumerTransaction)
        .leftJoin(
            consumptionProof,
            eq(consumerTransaction.proofId, consumptionProof.id),
        )
        .leftJoin(
            redemptionRequest,
            eq(consumerTransaction.redemptionRequestId, redemptionRequest.id),
        )
        .leftJoin(cafe, eq(consumerTransaction.cafeId, cafe.id))
        .leftJoin(
            cafeProduct,
            eq(
                cafeProduct.id,
                // Emissions use the proof product; rewards use the request product.
                // COALESCE keeps legacy rows with incomplete metadata renderable.
                sql`coalesce(${consumptionProof.productId}, ${redemptionRequest.productId})`,
            ),
        )
        .leftJoin(
            consumerVoucher,
            eq(redemptionRequest.voucherId, consumerVoucher.id),
        )
        .leftJoin(campaign, eq(consumerVoucher.campaignId, campaign.id))
        .leftJoin(coffeeCrawl, eq(consumerVoucher.crawlId, coffeeCrawl.id))
        .where(
            and(
                eq(consumerTransaction.consumerUserId, consumerUserId),
                eq(consumerTransaction.status, "confirmed"),
            ),
        )
        .orderBy(desc(consumerTransaction.createdAt));

    return ok(
        rows.map((row) => ({
            id: row.id,
            operation: row.operation,
            cafeId: row.cafeId,
            cafeName: row.cafeName ?? null,
            productName: row.productName ?? null,
            campaignName: row.campaignName ?? null,
            crawlName: row.crawlName ?? null,
            status: row.status,
            rejectionReason: row.rejectionReason,
            createdAt: row.createdAt.toISOString(),
        })),
    );
}
