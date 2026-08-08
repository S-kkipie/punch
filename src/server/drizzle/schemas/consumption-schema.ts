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

export const purchaseProofStatus = pgEnum("purchase_proof_status", [
    "issued",
    "confirmed",
]);

export const consumptionProof = pgTable(
    "consumption_proof",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "cascade" }),
        productId: text("product_id")
            .notNull()
            .references(() => cafeProduct.id, { onDelete: "cascade" }),
        issuedByUserId: text("issued_by_user_id")
            .notNull()
            .references(() => user.id),
        consumerUserId: text("consumer_user_id").references(() => user.id),
        amountCentimos: integer("amount_centimos").notNull(),
        receiptHash: text("receipt_hash").notNull(),
        nonce: text("nonce").notNull(),
        cafeSignature: text("cafe_signature").notNull(),
        consumerSignature: text("consumer_signature"),
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
        index("consumption_proof_cafe_id_idx").on(table.cafeId),
        check(
            "consumption_proof_amount_positive",
            sql`${table.amountCentimos} > 0`,
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
        redemptionRequestId: text("redemption_request_id"),
        chainTxId: text("chain_tx_id").notNull(),
        status: consumerTransactionStatus("status")
            .default("pending")
            .notNull(),
        rejectionReason: text("rejection_reason"),
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
        index("consumer_transaction_consumer_id_idx").on(table.consumerUserId),
        index("consumer_transaction_proof_id_idx").on(table.proofId),
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
        voucherId: text("voucher_id"),
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
    ],
);

export type ConsumptionProofRow = typeof consumptionProof.$inferSelect;
export type NewConsumptionProofRow = typeof consumptionProof.$inferInsert;
export type ConsumerTransactionRow = typeof consumerTransaction.$inferSelect;
export type NewConsumerTransactionRow = typeof consumerTransaction.$inferInsert;
export type RedemptionRequestRow = typeof redemptionRequest.$inferSelect;
export type NewRedemptionRequestRow = typeof redemptionRequest.$inferInsert;
