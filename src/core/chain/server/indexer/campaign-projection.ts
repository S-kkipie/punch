// biome-ignore-all lint/suspicious/noExplicitAny: Drizzle's generic transaction builder is intentionally abstract here
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";
import {
    campaign,
    chainPurchaseEffect,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import type { IndexerEvent, IndexerTransaction } from "./apply-event";

const MAX_SQL_INT = 2_147_483_647n;
const MAX_SQL_BIGINT = 9_223_372_036_854_775_807n;
const MAX_SAFE_SECONDS = BigInt(Number.MAX_SAFE_INTEGER);

function chainInt(value: unknown, label: string): number {
    const n = typeof value === "bigint" ? value : BigInt(String(value));
    if (n < 0n || n > MAX_SQL_INT)
        throw new Error(`${label} overflows SQL integer`);
    return Number(n);
}

function chainBigint(value: unknown, label: string): bigint {
    const n = typeof value === "bigint" ? value : BigInt(String(value));
    if (n < 0n || n > MAX_SQL_BIGINT) {
        throw new Error(`${label} overflows SQL bigint`);
    }
    return n;
}

function expiry(value: unknown): Date {
    const seconds = typeof value === "bigint" ? value : BigInt(String(value));
    if (seconds < 0n || seconds > MAX_SAFE_SECONDS) {
        throw new Error("campaign expiry overflows JavaScript date");
    }
    return new Date(Number(seconds) * 1000);
}

function block(event: IndexerEvent): bigint {
    if (event.blockNumber < 0n) throw new Error("invalid block number");
    return event.blockNumber;
}

function address(value: unknown): string {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
        throw new Error("invalid event address");
    }
    return value.toLowerCase();
}

async function applyCreated(tx: IndexerTransaction, event: IndexerEvent) {
    const chainCampaignId = chainInt(
        event.args.campaignId,
        "chain campaign id",
    );
    chainInt(event.args.sourceCafeId, "source cafe id");
    await tx
        .insert(projectionCampaign)
        .values({
            chainCampaignId,
            status: "draft",
            budget: 0n,
            voucherPayout: 0n,
            maxVouchers: 0,
            expiry: new Date(0),
            unlockedCount: 0,
            redeemedCount: 0,
            lastBlock: block(event),
        })
        .onConflictDoUpdate({
            target: projectionCampaign.chainCampaignId,
            set: {
                lastBlock: sql`GREATEST(${projectionCampaign.lastBlock}, ${block(event)})`,
            },
        });
}

async function applyFunded(tx: IndexerTransaction, event: IndexerEvent) {
    const chainCampaignId = chainInt(
        event.args.campaignId,
        "chain campaign id",
    );
    const amount = chainBigint(event.args.amount, "campaign funding amount");
    await tx
        .update(projectionCampaign)
        .set({
            budget: sql`${projectionCampaign.budget} + ${amount}`,
            lastBlock: block(event),
        })
        .where(
            and(
                eq(projectionCampaign.chainCampaignId, chainCampaignId),
                sql`${projectionCampaign.lastBlock} < ${block(event)}`,
            ),
        );
}

async function applyPublished(tx: IndexerTransaction, event: IndexerEvent) {
    const chainCampaignId = chainInt(
        event.args.campaignId,
        "chain campaign id",
    );
    const voucherPayout = chainBigint(
        event.args.voucherPayout,
        "voucher payout",
    );
    const maxVouchers = chainInt(event.args.maxVouchers, "maximum vouchers");
    await tx
        .update(projectionCampaign)
        .set({
            status: "published",
            voucherPayout,
            maxVouchers,
            expiry: expiry(event.args.expiry),
            lastBlock: sql`GREATEST(${projectionCampaign.lastBlock}, ${block(event)})`,
        })
        .where(
            and(
                eq(projectionCampaign.chainCampaignId, chainCampaignId),
                sql`${projectionCampaign.lastBlock} <= ${block(event)}`,
            ),
        );
}

async function findCampaign(tx: IndexerTransaction, event: IndexerEvent) {
    const chainCampaignId = chainInt(
        event.args.campaignId,
        "chain campaign id",
    );
    const rows = await tx
        .select({
            id: campaign.id,
            cafeId: campaign.cafeId,
            expiry: projectionCampaign.expiry,
        })
        .from(projectionCampaign)
        .innerJoin(
            campaign,
            eq(campaign.chainCampaignId, projectionCampaign.chainCampaignId),
        )
        .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));
    const row = rows[0];
    if (!row)
        throw new Error(
            `campaign ${chainCampaignId} is not linked to an app campaign`,
        );
    return row;
}

async function applyUnlocked(tx: IndexerTransaction, event: IndexerEvent) {
    const appCampaign = await findCampaign(tx, event);
    const userAddress = address(event.args.user);
    const users = await tx
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.walletAddress}) = ${userAddress}`);
    const appUser = users[0];
    if (!appUser) throw new Error(`no app user for wallet ${userAddress}`);

    const chainCampaignId = chainInt(
        event.args.campaignId,
        "chain campaign id",
    );
    const updated = await tx
        .update(projectionCampaign)
        .set({
            unlockedCount: sql`${projectionCampaign.unlockedCount} + 1`,
            lastBlock: block(event),
        })
        .where(
            and(
                eq(projectionCampaign.chainCampaignId, chainCampaignId),
                sql`${projectionCampaign.lastBlock} < ${block(event)}`,
            ),
        )
        .returning({ chainCampaignId: projectionCampaign.chainCampaignId });
    if (updated.length === 0) return;

    await tx
        .insert(consumerVoucher)
        .values({
            source: "campaign",
            campaignId: appCampaign.id,
            consumerUserId: appUser.id,
            cafeId: appCampaign.cafeId,
            expiresAt: appCampaign.expiry,
            chainUnlockTxHash: event.transactionHash,
        })
        .onConflictDoNothing({
            target: [
                consumerVoucher.campaignId,
                consumerVoucher.consumerUserId,
            ],
        });
    const vouchers = await tx
        .select({ id: consumerVoucher.id })
        .from(consumerVoucher)
        .where(
            and(
                eq(consumerVoucher.campaignId, appCampaign.id),
                eq(consumerVoucher.consumerUserId, appUser.id),
            ),
        );
    const voucher = vouchers[0];
    if (!voucher) return;

    const effects = await tx
        .select({ id: chainPurchaseEffect.id })
        .from(chainPurchaseEffect)
        .innerJoin(
            purchaseOrder,
            eq(purchaseOrder.id, chainPurchaseEffect.purchaseOrderId),
        )
        .where(
            and(
                eq(chainPurchaseEffect.kind, "campaign_qualification"),
                eq(chainPurchaseEffect.targetId, appCampaign.id),
                eq(purchaseOrder.userId, appUser.id),
            ),
        );
    for (const effect of effects) {
        await tx
            .update(chainPurchaseEffect)
            .set({ createdVoucherId: voucher.id })
            .where(eq(chainPurchaseEffect.id, effect.id));
    }
}

async function applyRedeemed(tx: IndexerTransaction, event: IndexerEvent) {
    const appCampaign = await findCampaign(tx, event);
    const userAddress = address(event.args.user);
    const users = await tx
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.walletAddress}) = ${userAddress}`);
    const appUser = users[0];
    if (!appUser) throw new Error(`no app user for wallet ${userAddress}`);
    const chainCampaignId = chainInt(
        event.args.campaignId,
        "chain campaign id",
    );
    const updated = await tx
        .update(projectionCampaign)
        .set({
            redeemedCount: sql`${projectionCampaign.redeemedCount} + 1`,
            budget: sql`${projectionCampaign.budget} - ${projectionCampaign.voucherPayout}`,
            lastBlock: block(event),
        })
        .where(
            and(
                eq(projectionCampaign.chainCampaignId, chainCampaignId),
                sql`${projectionCampaign.lastBlock} < ${block(event)}`,
            ),
        )
        .returning({ chainCampaignId: projectionCampaign.chainCampaignId });
    if (updated.length === 0) return;
    await tx
        .update(consumerVoucher)
        .set({ status: "redeemed", redeemedAt: new Date() })
        .where(
            and(
                eq(consumerVoucher.campaignId, appCampaign.id),
                eq(consumerVoucher.consumerUserId, appUser.id),
                eq(consumerVoucher.status, "available"),
            ),
        );
}

export async function applyCampaignEvent(
    tx: IndexerTransaction,
    event: IndexerEvent,
): Promise<void> {
    switch (event.eventName) {
        case "CampaignCreated":
            return applyCreated(tx, event);
        case "CampaignFunded":
            return applyFunded(tx, event);
        case "CampaignPublished":
            return applyPublished(tx, event);
        case "VoucherUnlocked":
            return applyUnlocked(tx, event);
        case "VoucherRedeemed":
            return applyRedeemed(tx, event);
        default:
            throw new Error(`unsupported campaign event ${event.eventName}`);
    }
}
