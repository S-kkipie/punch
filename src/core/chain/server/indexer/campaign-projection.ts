// biome-ignore-all lint/suspicious/noExplicitAny: Drizzle's generic transaction builder is intentionally abstract here
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";
import {
    campaign,
    consumerVoucher,
} from "@/server/drizzle/schemas/punch-schema";
import {
    enqueueReferralRecord,
    referralKeyForVoucher,
} from "../network-fund/referrals";
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

function transactionIndex(event: IndexerEvent): number {
    if (
        !Number.isInteger(event.transactionIndex) ||
        event.transactionIndex < 0 ||
        event.transactionIndex > Number(MAX_SQL_INT)
    ) {
        throw new Error("transaction index overflows SQL integer");
    }
    return event.transactionIndex;
}

function logIndex(event: IndexerEvent): number {
    if (
        !Number.isInteger(event.logIndex) ||
        event.logIndex < 0 ||
        event.logIndex > Number(MAX_SQL_INT)
    ) {
        throw new Error("log index overflows SQL integer");
    }
    return event.logIndex;
}

function eventIsAfter(event: IndexerEvent) {
    return sql`(${projectionCampaign.lastBlock} < ${block(event)} OR (${projectionCampaign.lastBlock} = ${block(event)} AND (${projectionCampaign.lastTransactionIndex} < ${transactionIndex(event)} OR (${projectionCampaign.lastTransactionIndex} = ${transactionIndex(event)} AND ${projectionCampaign.lastLogIndex} < ${logIndex(event)}))))`;
}

function eventIsAtOrAfter(event: IndexerEvent) {
    return sql`(${projectionCampaign.lastBlock} < ${block(event)} OR (${projectionCampaign.lastBlock} = ${block(event)} AND (${projectionCampaign.lastTransactionIndex} < ${transactionIndex(event)} OR (${projectionCampaign.lastTransactionIndex} = ${transactionIndex(event)} AND ${projectionCampaign.lastLogIndex} <= ${logIndex(event)}))))`;
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
            lastTransactionIndex: transactionIndex(event),
            lastLogIndex: logIndex(event),
        })
        .onConflictDoNothing({
            target: projectionCampaign.chainCampaignId,
        });
}

async function applyFunded(tx: IndexerTransaction, event: IndexerEvent) {
    const chainCampaignId = chainInt(
        event.args.campaignId,
        "chain campaign id",
    );
    const amount = chainBigint(event.args.amount, "campaign funding amount");
    const updated = await tx
        .update(projectionCampaign)
        .set({
            budget: sql`${projectionCampaign.budget} + ${amount}`,
            lastBlock: block(event),
            lastTransactionIndex: transactionIndex(event),
            lastLogIndex: logIndex(event),
        })
        .where(
            and(
                eq(projectionCampaign.chainCampaignId, chainCampaignId),
                eventIsAfter(event),
            ),
        )
        .returning({ chainCampaignId: projectionCampaign.chainCampaignId });
    if (updated.length > 0) return;
    const existing = await tx
        .select({ chainCampaignId: projectionCampaign.chainCampaignId })
        .from(projectionCampaign)
        .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));
    if (existing.length === 0)
        throw new Error(`campaign ${chainCampaignId} does not exist`);
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
            lastBlock: block(event),
            lastTransactionIndex: transactionIndex(event),
            lastLogIndex: logIndex(event),
        })
        .where(
            and(
                eq(projectionCampaign.chainCampaignId, chainCampaignId),
                eventIsAtOrAfter(event),
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
            lastTransactionIndex: transactionIndex(event),
            lastLogIndex: logIndex(event),
        })
        .where(
            and(
                eq(projectionCampaign.chainCampaignId, chainCampaignId),
                eventIsAfter(event),
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

    const [cafeRow] = await tx
        .select({ chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .where(eq(cafe.id, appCampaign.cafeId));
    if (cafeRow?.chainCafeId != null) {
        await enqueueReferralRecord(tx, {
            originChainCafeId: cafeRow.chainCafeId,
            referralKey: referralKeyForVoucher(chainCampaignId, userAddress),
        });
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
            lastTransactionIndex: transactionIndex(event),
            lastLogIndex: logIndex(event),
        })
        .where(
            and(
                eq(projectionCampaign.chainCampaignId, chainCampaignId),
                eventIsAfter(event),
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
