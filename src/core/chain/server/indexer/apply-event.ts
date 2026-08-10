// biome-ignore-all lint/suspicious/noExplicitAny: Drizzle's generic transaction builder is intentionally abstract here
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import {
    projectionCafeCredit,
    projectionConsumption,
    projectionPunchBalance,
} from "@/server/drizzle/schemas/chain-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";
import { applyCampaignEvent } from "./campaign-projection";
import { applyConfirmedConsumptionProjection } from "./purchase-projection";
import { applyRewardRedeemedProjection } from "./redemption-projection";

export const CREDITS_PER_PURCHASE = 100n;
const MAX_SQL_INT = 2_147_483_647;

type EventArgs = Record<string, unknown>;
export type IndexerEvent = {
    eventName:
        | "PunchIssued"
        | "RewardRedeemed"
        | "ConsumptionRecorded"
        | "EmissionCreditConsumed"
        | "PlanActivated"
        | "PackPurchased"
        | "CampaignCreated"
        | "CampaignFunded"
        | "CampaignPublished"
        | "VoucherUnlocked"
        | "VoucherRedeemed";
    args: EventArgs;
    blockNumber: bigint;
    transactionHash: string;
    logIndex: number;
    transactionIndex: number;
};
export type IndexerTransaction = {
    insert: (table: any) => any;
    update: (table: any) => any;
    select: (fields?: any) => any;
};

function address(value: unknown): string {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
        throw new Error("invalid event address");
    }
    return value.toLowerCase();
}

function int32(value: number, label: string): number {
    if (!Number.isInteger(value) || value < 0 || value > MAX_SQL_INT) {
        throw new Error(`${label} overflows SQL integer`);
    }
    return value;
}

function cafeId(value: unknown): number {
    const id = typeof value === "bigint" ? value : BigInt(String(value));
    if (id < 0n || id > BigInt(MAX_SQL_INT)) {
        throw new Error("chain cafe id overflows SQL integer");
    }
    return Number(id);
}

function receiptHash(value: unknown): string {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error("invalid receipt hash");
    }
    return value.toLowerCase();
}

function block(event: IndexerEvent): bigint {
    if (event.blockNumber < 0n) throw new Error("invalid block number");
    return event.blockNumber;
}

function logIndex(event: IndexerEvent): number {
    return int32(event.logIndex, "log index");
}

async function addPunch(tx: IndexerTransaction, event: IndexerEvent) {
    const userAddress = address(event.args.user);
    await tx
        .insert(projectionPunchBalance)
        .values({ userAddress, balance: 1n, lastBlock: block(event) })
        .onConflictDoUpdate({
            target: projectionPunchBalance.userAddress,
            set: {
                balance: sql`${projectionPunchBalance.balance} + 1`,
                lastBlock: sql`GREATEST(${projectionPunchBalance.lastBlock}, ${block(event)})`,
            },
        });
}

async function addCredits(tx: IndexerTransaction, event: IndexerEvent) {
    const chainCafeId = cafeId(event.args.cafeId);
    await tx
        .insert(projectionCafeCredit)
        .values({
            chainCafeId,
            credits: CREDITS_PER_PURCHASE,
            lastBlock: block(event),
        })
        .onConflictDoUpdate({
            target: projectionCafeCredit.chainCafeId,
            set: {
                credits: sql`${projectionCafeCredit.credits} + ${CREDITS_PER_PURCHASE}`,
                lastBlock: sql`GREATEST(${projectionCafeCredit.lastBlock}, ${block(event)})`,
            },
        });
}

async function consumeCredit(tx: IndexerTransaction, event: IndexerEvent) {
    const chainCafeId = cafeId(event.args.cafeId);
    const rows = await tx
        .update(projectionCafeCredit)
        .set({
            credits: sql`${projectionCafeCredit.credits} - 1`,
            lastBlock: sql`GREATEST(${projectionCafeCredit.lastBlock}, ${block(event)})`,
        })
        .where(
            and(
                eq(projectionCafeCredit.chainCafeId, chainCafeId),
                sql`${projectionCafeCredit.credits} > 0`,
            ),
        )
        .returning({ chainCafeId: projectionCafeCredit.chainCafeId });
    if (rows.length === 0) {
        throw new Error(
            `cannot consume credit for cafe ${chainCafeId} before activation`,
        );
    }
}

async function confirmMatchingOrder(
    tx: IndexerTransaction,
    chainCafeId: number,
    userAddress: string,
    hash: string,
    event: IndexerEvent,
) {
    const matches = await tx
        .select({ id: purchaseOrder.id, status: purchaseOrder.status })
        .from(purchaseOrder)
        .innerJoin(cafe, eq(cafe.id, purchaseOrder.cafeId))
        .innerJoin(user, eq(user.id, purchaseOrder.userId))
        .where(
            and(
                eq(purchaseOrder.receiptHash, hash),
                eq(cafe.chainCafeId, chainCafeId),
                sql`lower(${user.walletAddress}) = ${userAddress}`,
            ),
        );
    const order = matches[0];
    if (!order) return;
    await applyConfirmedConsumptionProjection(tx, {
        orderId: order.id,
        txHash: event.transactionHash as `0x${string}`,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
    });
}

async function recordConsumption(tx: IndexerTransaction, event: IndexerEvent) {
    const chainCafeId = cafeId(event.args.cafeId);
    const userAddress = address(event.args.user);
    const hash = receiptHash(event.args.receiptHash);
    await tx
        .insert(projectionConsumption)
        .values({
            txHash: event.transactionHash,
            logIndex: logIndex(event),
            chainCafeId,
            userAddress,
            receiptHash: hash,
            block: block(event),
        })
        .onConflictDoNothing({
            target: [
                projectionConsumption.txHash,
                projectionConsumption.logIndex,
            ],
        });
    await confirmMatchingOrder(tx, chainCafeId, userAddress, hash, event);
}

export async function applyEvent(
    tx: IndexerTransaction,
    event: IndexerEvent,
): Promise<void> {
    switch (event.eventName) {
        case "PunchIssued":
            return addPunch(tx, event);
        case "RewardRedeemed":
            return applyRewardRedeemedProjection(tx, {
                userAddress: address(event.args.user),
                chainCafeId: cafeId(event.args.hostCafeId),
                chainProductId: cafeId(event.args.productId),
                txHash: event.transactionHash,
                logIndex: logIndex(event),
                blockNumber: block(event),
            });
        case "ConsumptionRecorded":
            return recordConsumption(tx, event);
        case "EmissionCreditConsumed":
            return consumeCredit(tx, event);
        case "PlanActivated":
        case "PackPurchased":
            return addCredits(tx, event);
        case "CampaignCreated":
        case "CampaignFunded":
        case "CampaignPublished":
        case "VoucherUnlocked":
        case "VoucherRedeemed":
            return applyCampaignEvent(tx, event);
        default: {
            const neverEvent: never = event.eventName;
            throw new Error(`unsupported event ${neverEvent}`);
        }
    }
}
