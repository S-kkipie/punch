import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    index,
    integer,
    numeric,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const cafeOnboardingStatus = pgEnum("cafe_onboarding_status", [
    "draft",
    "submitted",
    "approved",
    "rejected",
]);

export const cafe = pgTable(
    "cafe",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        name: text("name").notNull(),
        slug: text("slug").notNull().unique(),
        description: text("description"),
        address: text("address"),
        district: text("district"),
        lat: numeric("lat"),
        lng: numeric("lng"),
        photoUrl: text("photo_url"),
        ruc: text("ruc"),
        contactPhone: text("contact_phone"),
        chainCafeId: integer("chain_cafe_id").unique(),
        onboardingStatus: cafeOnboardingStatus("onboarding_status")
            .default("draft")
            .notNull(),
        reviewNote: text("review_note"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("cafe_onboarding_status_idx").on(table.onboardingStatus),
        check("cafe_name_not_empty", sql`length(trim(${table.name})) > 0`),
    ],
);

export const cafeProductType = pgEnum("cafe_product_type", [
    "emission",
    "reward",
]);
export const productApprovalStatus = pgEnum("product_approval_status", [
    "pending",
    "approved",
    "rejected",
]);

export const cafeProduct = pgTable(
    "cafe_product",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        description: text("description"),
        chainProductId: integer("chain_product_id"),
        priceSoles: numeric("price_soles").notNull(),
        cogsSoles: numeric("cogs_soles"),
        type: cafeProductType("type").notNull(),
        approvalStatus: productApprovalStatus("approval_status")
            .default("pending")
            .notNull(),
        reviewNote: text("review_note"),
        active: boolean("active").default(true).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("cafe_product_cafe_id_idx").on(table.cafeId),
        check("cafe_product_price_positive", sql`${table.priceSoles} > 0`),
        check(
            "cafe_product_reward_price_cap",
            sql`${table.type} <> 'reward' OR ${table.priceSoles} <= 12`,
        ),
    ],
);

export type CafeRow = typeof cafe.$inferSelect;
export type NewCafeRow = typeof cafe.$inferInsert;
export type CafeProductRow = typeof cafeProduct.$inferSelect;
export type NewCafeProductRow = typeof cafeProduct.$inferInsert;

export const cafeMemberRole = pgEnum("cafe_member_role", ["owner", "barista"]);

export const cafeMember = pgTable(
    "cafe_member",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "cascade" }),
        role: cafeMemberRole("role").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("cafe_member_user_cafe_uq").on(table.userId, table.cafeId),
        index("cafe_member_cafe_id_idx").on(table.cafeId),
    ],
);

export type CafeMemberRow = typeof cafeMember.$inferSelect;
export type CafeMemberRole = (typeof cafeMemberRole.enumValues)[number];
