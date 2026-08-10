import { sql } from "drizzle-orm";
import {
    bigint,
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
import { cafe } from "./cafe-schema";

export const planOrderKind = pgEnum("plan_order_kind", ["plan", "pack"]);

export const planOrderStatus = pgEnum("plan_order_status", [
    "pending",
    "submitted",
    "confirmed",
    "failed",
]);

export const planOrder = pgTable(
    "plan_order",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "restrict" }),
        // Snapshot so the runner never needs a join to build the call.
        chainCafeId: integer("chain_cafe_id").notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "restrict" }),
        kind: planOrderKind("kind").notNull(),
        // mPEN, 6 decimals: 49e6 for a plan, 40e6 for a pack.
        price: bigint("price", { mode: "bigint" }).notNull(),
        signerAddress: text("signer_address").notNull(),
        signerWalletIndex: integer("signer_wallet_index").notNull(),
        status: planOrderStatus("status").default("pending").notNull(),
        attempts: integer("attempts").default(0).notNull(),
        nextRetryAt: timestamp("next_retry_at").defaultNow().notNull(),
        txHash: text("tx_hash"),
        lastError: text("last_error"),
        failureReason: text("failure_reason"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (t) => [
        index("plan_order_cafe_created_idx").on(t.cafeId, t.createdAt),
        index("plan_order_status_retry_idx").on(t.status, t.nextRetryAt),
        // One payment in flight per cafe: a double click can never charge twice.
        uniqueIndex("plan_order_cafe_inflight_uq")
            .on(t.cafeId)
            .where(sql`${t.status} in ('pending', 'submitted')`),
        check("plan_order_price_positive", sql`${t.price} > 0`),
    ],
);

export type PlanOrderRow = typeof planOrder.$inferSelect;
