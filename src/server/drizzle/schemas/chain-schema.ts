import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";

export const projectionPunchBalance = pgTable("projection_punch_balance", {
    userAddress: text("user_address").primaryKey(),
    balance: bigint("balance", { mode: "bigint" }).notNull(),
    lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
});

export const projectionCafeCredit = pgTable("projection_cafe_credit", {
    chainCafeId: integer("chain_cafe_id").primaryKey(),
    credits: bigint("credits", { mode: "bigint" }).notNull(),
    lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
});

export const campaignProjectionStatus = pgEnum("campaign_projection_status", [
    "draft",
    "published",
    "cancelled",
]);

export const projectionCampaign = pgTable("projection_campaign", {
    chainCampaignId: integer("chain_campaign_id").primaryKey(),
    status: campaignProjectionStatus("status").notNull(),
    budget: bigint("budget", { mode: "bigint" }).notNull(),
    voucherPayout: bigint("voucher_payout", { mode: "bigint" })
        .default(sql`0`)
        .notNull(),
    maxVouchers: integer("max_vouchers").default(0).notNull(),
    expiry: timestamp("expiry").notNull(),
    unlockedCount: integer("unlocked_count").default(0).notNull(),
    redeemedCount: integer("redeemed_count").default(0).notNull(),
    lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
    lastTransactionIndex: integer("last_transaction_index")
        .default(0)
        .notNull(),
    lastLogIndex: integer("last_log_index").default(0).notNull(),
});

export type ProjectionCampaignRow = typeof projectionCampaign.$inferSelect;

export const projectionConsumption = pgTable(
    "projection_consumption",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        txHash: text("tx_hash").notNull(),
        logIndex: integer("log_index").notNull(),
        chainCafeId: integer("chain_cafe_id").notNull(),
        userAddress: text("user_address").notNull(),
        receiptHash: text("receipt_hash").notNull(),
        block: bigint("block", { mode: "bigint" }).notNull(),
    },
    (t) => [
        uniqueIndex("projection_consumption_tx_log_uq").on(
            t.txHash,
            t.logIndex,
        ),
    ],
);

export const indexerCursor = pgTable("indexer_cursor", {
    contract: text("contract").primaryKey(),
    lastProcessedBlock: bigint("last_processed_block", {
        mode: "bigint",
    }).notNull(),
});

export const projectionStatus = pgTable("projection_status", {
    projection: text("projection").primaryKey(),
    paused: boolean("paused").default(false).notNull(),
    lastGoodBlock: bigint("last_good_block", { mode: "bigint" })
        .default(sql`0`)
        .notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .$onUpdate(() => new Date())
        .notNull(),
});
