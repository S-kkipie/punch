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
    "punch_redemption",
]);

export const relayerJob = pgTable(
    "relayer_job",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        kind: relayerJobKind("kind").default("consumption").notNull(),
        orderId: text("order_id")
            .unique()
            .references(() => purchaseOrder.id, { onDelete: "restrict" }),
        // punch_redemption jobs: FK to redemption_request added in raw SQL
        // (declaring it here would create a schema-module import cycle).
        redemptionRequestId: text("redemption_request_id").unique(),
        // consumption: { proof, cafeSignature, userSignature }
        // punch_redemption: { userWallet, chainCafeId, chainProductId }
        payload: jsonb("payload").notNull(),
        attempts: integer("attempts").default(0).notNull(),
        nextRetryAt: timestamp("next_retry_at").defaultNow().notNull(),
        status: relayerJobStatus("status").default("pending").notNull(),
        txHash: text("tx_hash"),
        lastError: text("last_error"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (t) => [
        index("relayer_job_status_retry_idx").on(t.status, t.nextRetryAt),
        check(
            "relayer_job_target_check",
            sql`(${t.kind} = 'consumption' AND ${t.orderId} IS NOT NULL AND ${t.redemptionRequestId} IS NULL) OR (${t.kind} = 'punch_redemption' AND ${t.redemptionRequestId} IS NOT NULL AND ${t.orderId} IS NULL)`,
        ),
    ],
);

export type PurchaseOrderRow = typeof purchaseOrder.$inferSelect;
export type RelayerJobRow = typeof relayerJob.$inferSelect;
