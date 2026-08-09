import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { cafe } from "./cafe-schema";
import { purchaseOrder } from "./purchase-schema";

export const punchBalanceProjection = pgTable(
    "punch_balance_projection",
    {
        userId: text("user_id")
            .primaryKey()
            .references(() => user.id, { onDelete: "cascade" }),
        balance: integer("balance").default(0).notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        check(
            "punch_balance_projection_balance_nonneg",
            sql`${table.balance} >= 0`,
        ),
    ],
);

export const campaignKind = pgEnum("campaign_kind", ["verified_acquisition"]);
export const chainPurchaseEffectKind = pgEnum("chain_purchase_effect_kind", [
    "campaign_qualification",
    "crawl_step",
]);

export const chainPurchaseEffect = pgTable(
    "chain_purchase_effect",
    {
        id: text("id").primaryKey(),
        purchaseOrderId: text("purchase_order_id")
            .notNull()
            .references(() => purchaseOrder.id, { onDelete: "cascade" }),
        kind: chainPurchaseEffectKind("kind").notNull(),
        targetId: text("target_id").notNull(),
        createdVoucherId: text("created_voucher_id"),
        progressId: text("progress_id"),
        transactionHash: text("transaction_hash").notNull(),
        logIndex: integer("log_index").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("chain_purchase_effect_order_kind_target_uq").on(
            table.purchaseOrderId,
            table.kind,
            table.targetId,
        ),
    ],
);

export const campaign = pgTable(
    "campaign",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        kind: campaignKind("kind").notNull(),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "restrict" }),
        name: text("name").notNull(),
        windowStart: timestamp("window_start").notNull(),
        windowEnd: timestamp("window_end").notNull(),
        active: boolean("active").default(true).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        check(
            "campaign_window_order",
            sql`${table.windowStart} <= ${table.windowEnd}`,
        ),
    ],
);

export const voucherSource = pgEnum("voucher_source", ["campaign", "crawl"]);
export const voucherStatus = pgEnum("voucher_status", [
    "available",
    "redeemed",
    "expired",
]);

export const consumerVoucher = pgTable(
    "consumer_voucher",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        source: voucherSource("source").notNull(),
        campaignId: text("campaign_id").references(() => campaign.id),
        crawlId: text("crawl_id").references(() => coffeeCrawl.id),
        consumerUserId: text("consumer_user_id")
            .notNull()
            .references(() => user.id),
        cafeId: text("cafe_id").references(() => cafe.id),
        status: voucherStatus("status").default("available").notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        redeemedAt: timestamp("redeemed_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("consumer_voucher_campaign_unlock_uq").on(
            table.campaignId,
            table.consumerUserId,
        ),
        uniqueIndex("consumer_voucher_crawl_unlock_uq").on(
            table.crawlId,
            table.consumerUserId,
        ),
        check(
            "consumer_voucher_source_provenance",
            sql`(${table.source} = 'campaign' AND ${table.campaignId} IS NOT NULL AND ${table.crawlId} IS NULL) OR (${table.source} = 'crawl' AND ${table.campaignId} IS NULL AND ${table.crawlId} IS NOT NULL)`,
        ),
    ],
);

export const coffeeCrawl = pgTable("coffee_crawl", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const coffeeCrawlStep = pgTable(
    "coffee_crawl_step",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        crawlId: text("crawl_id")
            .notNull()
            .references(() => coffeeCrawl.id, { onDelete: "cascade" }),
        stepIndex: integer("step_index").notNull(),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id),
    },
    (table) => [
        uniqueIndex("coffee_crawl_step_crawl_index_uq").on(
            table.crawlId,
            table.stepIndex,
        ),
        uniqueIndex("coffee_crawl_step_crawl_cafe_uq").on(
            table.crawlId,
            table.cafeId,
        ),
        check("coffee_crawl_step_index_nonneg", sql`${table.stepIndex} >= 0`),
    ],
);

export const crawlProgressStatus = pgEnum("crawl_progress_status", [
    "in_progress",
    "completed",
    "expired",
]);

export const consumerCrawlProgress = pgTable(
    "consumer_crawl_progress",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        crawlId: text("crawl_id")
            .notNull()
            .references(() => coffeeCrawl.id, { onDelete: "cascade" }),
        consumerUserId: text("consumer_user_id")
            .notNull()
            .references(() => user.id),
        completedCafeIds: text("completed_cafe_ids")
            .array()
            .default([])
            .notNull(),
        status: crawlProgressStatus("status").default("in_progress").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("consumer_crawl_progress_uq").on(
            table.crawlId,
            table.consumerUserId,
        ),
    ],
);

export type PunchBalanceProjectionRow =
    typeof punchBalanceProjection.$inferSelect;
export type CampaignRow = typeof campaign.$inferSelect;
export type ConsumerVoucherRow = typeof consumerVoucher.$inferSelect;
export type NewConsumerVoucherRow = typeof consumerVoucher.$inferInsert;
export type CoffeeCrawlRow = typeof coffeeCrawl.$inferSelect;
export type CoffeeCrawlStepRow = typeof coffeeCrawlStep.$inferSelect;
export type ConsumerCrawlProgressRow =
    typeof consumerCrawlProgress.$inferSelect;
export type NewConsumerCrawlProgressRow =
    typeof consumerCrawlProgress.$inferInsert;
