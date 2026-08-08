// biome-ignore-all lint/suspicious/noExplicitAny: Drizzle's generic transaction builder is intentionally abstract here
import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import {
    projectionCafeCredit,
    projectionConsumption,
    projectionPunchBalance,
} from "@/server/drizzle/schemas/chain-schema";
import { purchaseOrder } from "@/server/drizzle/schemas/purchase-schema";

export const CREDITS_PER_PURCHASE = 100n;
type EventArgs = Record<string, unknown>;
export type IndexerEvent = {
    eventName:
        | "PunchIssued"
        | "ConsumptionRecorded"
        | "EmissionCreditConsumed"
        | "PlanActivated"
        | "PackPurchased";
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
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
        throw new Error("invalid event address");
    return value.toLowerCase();
}
function cafeId(value: unknown): number {
    const id = typeof value === "bigint" ? value : BigInt(String(value));
    if (id < 0n || id > 2_147_483_647n)
        throw new Error("chain cafe id overflows SQL integer");
    return Number(id);
}
function receiptHash(value: unknown): string {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
        throw new Error("invalid receipt hash");
    return value.toLowerCase();
}
function block(event: IndexerEvent): bigint {
    if (event.blockNumber < 0n) throw new Error("invalid block number");
    return event.blockNumber;
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
async function changeCredits(
    tx: IndexerTransaction,
    event: IndexerEvent,
    delta: bigint,
) {
    const chainCafeId = cafeId(event.args.cafeId);
    await tx
        .insert(projectionCafeCredit)
        .values({ chainCafeId, credits: delta, lastBlock: block(event) })
        .onConflictDoUpdate({
            target: projectionCafeCredit.chainCafeId,
            set: {
                credits: sql`${projectionCafeCredit.credits} + ${delta}`,
                lastBlock: sql`GREATEST(${projectionCafeCredit.lastBlock}, ${block(event)})`,
            },
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
            logIndex: event.logIndex,
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
    if (
        !order ||
        order.status === "confirmed" ||
        order.status === "failed" ||
        order.status === "expired"
    )
        return;
    await tx
        .update(purchaseOrder)
        .set({ status: "confirmed", txHash: event.transactionHash })
        .where(
            and(
                eq(purchaseOrder.id, order.id),
                inArray(purchaseOrder.status, [
                    "user_confirmed",
                    "cafe_confirmed",
                    "queued",
                    "submitted",
                ]),
            ),
        );
}
export async function applyEvent(
    tx: IndexerTransaction,
    event: IndexerEvent,
): Promise<void> {
    switch (event.eventName) {
        case "PunchIssued":
            return addPunch(tx, event);
        case "ConsumptionRecorded":
            return recordConsumption(tx, event);
        case "EmissionCreditConsumed":
            return changeCredits(tx, event, -1n);
        case "PlanActivated":
        case "PackPurchased":
            return changeCredits(tx, event, CREDITS_PER_PURCHASE);
        default: {
            const neverEvent: never = event.eventName;
            throw new Error(`unsupported event ${neverEvent}`);
        }
    }
}
