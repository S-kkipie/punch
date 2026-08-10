import { sql } from "drizzle-orm";
import {
    bigint,
    check,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { cafe, cafeProduct } from "./cafe-schema";

export const purchaseOrderStatus = pgEnum("purchase_order_status", [
    "user_confirmed",
    "cafe_confirmed",
    "queued",
    "submitted",
    "confirmed",
    "failed",
    "expired",
]);

export const purchaseOrder = pgTable(
    "purchase_order",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "restrict" }),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "restrict" }),
        productId: text("product_id")
            .notNull()
            .references(() => cafeProduct.id, { onDelete: "restrict" }),
        // mPEN, 6 decimals, stored as string-safe bigint
        amount: bigint("amount", { mode: "bigint" }).notNull(),
        yapeRef: text("yape_ref").notNull(),
        receiptHash: text("receipt_hash").notNull(),
        nonce: text("nonce").notNull(), // random uint256 as decimal string
        expiry: timestamp("expiry").notNull(),
        status: purchaseOrderStatus("status")
            .default("user_confirmed")
            .notNull(),
        failureReason: text("failure_reason"),
        txHash: text("tx_hash"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (t) => [
        index("purchase_order_cafe_status_idx").on(t.cafeId, t.status),
        index("purchase_order_user_idx").on(t.userId),
        uniqueIndex("purchase_order_cafe_receipt_uq").on(
            t.cafeId,
            t.receiptHash,
        ),
        check("purchase_order_amount_positive", sql`${t.amount} > 0`),
    ],
);

export const relayerJobStatus = pgEnum("relayer_job_status", [
    "pending",
    "submitted",
    "confirmed",
    "failed",
]);

export const relayerJobKind = pgEnum("relayer_job_kind", [
    "consumption",
    "consumption_record",
    "punch_redemption",
    "campaign_create",
    "campaign_fund_approve",
    "campaign_fund",
    "campaign_publish",
    "voucher_unlock",
    "voucher_redeem",
]);

export const relayerJob = pgTable(
    "relayer_job",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        orderId: text("order_id").references(() => purchaseOrder.id, {
            onDelete: "restrict",
        }),
        kind: relayerJobKind("kind").default("consumption").notNull(),
        idempotencyKey: text("idempotency_key")
            .notNull()
            .$defaultFn(() => crypto.randomUUID())
            .unique(),
        redemptionRequestId: text("redemption_request_id").unique(),
        // { proof: {...stringified bigints}, cafeSignature, userSignature }
        payload: jsonb("payload").notNull(),
        attempts: integer("attempts").default(0).notNull(),
        nextRetryAt: timestamp("next_retry_at").defaultNow().notNull(),
        status: relayerJobStatus("status").default("pending").notNull(),
        txHash: text("tx_hash"),
        signedTx: text("signed_tx"),
        lastError: text("last_error"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (t) => [
        index("relayer_job_status_retry_idx").on(t.status, t.nextRetryAt),
        // Preserves the old UNIQUE(order_id) guarantee for purchase jobs only.
        uniqueIndex("relayer_job_consumption_order_uq")
            .on(t.orderId)
            .where(sql`${t.kind} in ('consumption', 'consumption_record')`),
        check(
            "relayer_job_target_check",
            sql`((${t.kind} in ('consumption', 'consumption_record') AND ${t.orderId} IS NOT NULL AND ${t.redemptionRequestId} IS NULL) OR (${t.kind} = 'punch_redemption' AND ${t.redemptionRequestId} IS NOT NULL AND ${t.orderId} IS NULL) OR (${t.kind} in ('campaign_create', 'campaign_fund_approve', 'campaign_fund', 'campaign_publish', 'voucher_unlock', 'voucher_redeem') AND ${t.orderId} IS NULL AND ${t.redemptionRequestId} IS NULL))`,
        ),
    ],
);

export type PurchaseOrderRow = typeof purchaseOrder.$inferSelect;
export type RelayerJobRow = typeof relayerJob.$inferSelect;
