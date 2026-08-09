import { sql } from "drizzle-orm";
import {
    check,
    index,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { cafe, cafeProduct } from "./cafe-schema";
import { consumerVoucher } from "./punch-schema";
import { purchaseOrder } from "./purchase-schema";

export const purchaseProofStatus = pgEnum("purchase_proof_status", [
    "issued",
    "submitted",
    "confirmed",
    "failed",
    "expired",
]);

export const consumptionProof = pgTable(
    "consumption_proof",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "restrict" }),
        productId: text("product_id")
            .notNull()
            .references(() => cafeProduct.id, { onDelete: "restrict" }),
        issuedByUserId: text("issued_by_user_id")
            .notNull()
            .references(() => user.id),
        consumerUserId: text("consumer_user_id").references(() => user.id),
        amountCentimos: integer("amount_centimos").notNull(),
        purchaseOrderId: text("purchase_order_id").references(
            () => purchaseOrder.id,
            { onDelete: "restrict" },
        ),
        yapeRef: text("yape_ref").notNull(),
        receiptHash: text("receipt_hash"),
        nonce: text("nonce"),
        cafeSignature: text("cafe_signature"),
        consumerSignature: text("consumer_signature"),
        failureReason: text("failure_reason"),
        status: purchaseProofStatus("status").default("issued").notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("consumption_proof_nonce_uq").on(table.nonce),
        uniqueIndex("consumption_proof_receipt_hash_uq").on(table.receiptHash),
        uniqueIndex("consumption_proof_purchase_order_uq")
            .on(table.purchaseOrderId)
            .where(sql`${table.purchaseOrderId} IS NOT NULL`),
        index("consumption_proof_cafe_id_idx").on(table.cafeId),
        check(
            "consumption_proof_amount_positive",
            sql`${table.amountCentimos} > 0`,
        ),
        check(
            "consumption_proof_submitted_binding",
            sql`${table.status} NOT IN ('submitted', 'confirmed') OR (${table.consumerUserId} IS NOT NULL AND ${table.purchaseOrderId} IS NOT NULL)`,
        ),
    ],
);

export const consumptionOperation = pgEnum("consumption_operation", [
    "emission",
    "punch_redemption",
    "voucher_redemption",
]);
export const consumerTransactionStatus = pgEnum("consumer_transaction_status", [
    "pending",
    "confirmed",
    "rejected",
    "failed",
]);

export const consumerTransaction = pgTable(
    "consumer_transaction",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        operation: consumptionOperation("operation").notNull(),
        consumerUserId: text("consumer_user_id")
            .notNull()
            .references(() => user.id),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id),
        proofId: text("proof_id").references(() => consumptionProof.id),
        redemptionRequestId: text("redemption_request_id").references(
            () => redemptionRequest.id,
        ),
        chainTxId: text("chain_tx_id").notNull(),
        status: consumerTransactionStatus("status")
            .default("pending")
            .notNull(),
        rejectionReason: text("rejection_reason"),
        modeledHostPayoutCentimos: integer("modeled_host_payout_centimos"),
        idempotencyKey: text("idempotency_key").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("consumer_transaction_idempotency_uq").on(
            table.idempotencyKey,
        ),
        uniqueIndex("consumer_transaction_proof_id_uq")
            .on(table.proofId)
            .where(sql`${table.proofId} IS NOT NULL`),
        uniqueIndex("consumer_transaction_redemption_request_id_uq")
            .on(table.redemptionRequestId)
            .where(sql`${table.redemptionRequestId} IS NOT NULL`),
        index("consumer_transaction_consumer_id_idx").on(table.consumerUserId),
        check(
            "consumer_transaction_operation_shape",
            sql`(${table.operation} = 'emission' AND ${table.proofId} IS NOT NULL AND ${table.redemptionRequestId} IS NULL) OR (${table.operation} IN ('punch_redemption', 'voucher_redemption') AND ${table.proofId} IS NULL AND ${table.redemptionRequestId} IS NOT NULL)`,
        ),
        check(
            "consumer_transaction_modeled_host_payout_shape",
            sql`(${table.operation} = 'punch_redemption' AND ((${table.status} = 'confirmed' AND coalesce(${table.modeledHostPayoutCentimos} = 360, false)) OR (${table.status} IN ('pending', 'rejected', 'failed') AND ${table.modeledHostPayoutCentimos} IS NULL))) OR (${table.operation} IN ('emission', 'voucher_redemption') AND ${table.modeledHostPayoutCentimos} IS NULL)`,
        ),
    ],
);

export const redemptionRequestKind = pgEnum("redemption_request_kind", [
    "punch_reward",
    "voucher",
]);
export const redemptionRequestStatus = pgEnum("redemption_request_status", [
    "pending",
    "approved",
    "rejected",
]);

export const redemptionRequest = pgTable(
    "redemption_request",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        kind: redemptionRequestKind("kind").notNull(),
        consumerUserId: text("consumer_user_id")
            .notNull()
            .references(() => user.id),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id),
        productId: text("product_id").references(() => cafeProduct.id),
        voucherId: text("voucher_id").references(() => consumerVoucher.id),
        status: redemptionRequestStatus("status").default("pending").notNull(),
        rejectionReason: text("rejection_reason"),
        decidedByUserId: text("decided_by_user_id").references(() => user.id),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("redemption_request_cafe_id_idx").on(table.cafeId),
        index("redemption_request_consumer_id_idx").on(table.consumerUserId),
        uniqueIndex("redemption_request_active_voucher_uq")
            .on(table.voucherId)
            .where(
                sql`${table.kind} = 'voucher' AND ${table.status} IN ('pending', 'approved') AND ${table.voucherId} IS NOT NULL`,
            ),
        check(
            "redemption_request_kind_shape",
            sql`(${table.kind} = 'punch_reward' AND ${table.productId} IS NOT NULL AND ${table.voucherId} IS NULL) OR (${table.kind} = 'voucher' AND ${table.productId} IS NULL AND ${table.voucherId} IS NOT NULL)`,
        ),
    ],
);

export type ConsumptionProofRow = typeof consumptionProof.$inferSelect;
export type NewConsumptionProofRow = typeof consumptionProof.$inferInsert;
export type ConsumerTransactionRow = typeof consumerTransaction.$inferSelect;
export type NewConsumerTransactionRow = typeof consumerTransaction.$inferInsert;
export type RedemptionRequestRow = typeof redemptionRequest.$inferSelect;
export type NewRedemptionRequestRow = typeof redemptionRequest.$inferInsert;
