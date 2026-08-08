import {
    index,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const cafeMemberRole = pgEnum("cafe_member_role", ["owner", "barista"]);

/**
 * Links a user to a café panel role. `cafeId` has no FK yet — the `cafe`
 * table arrives in sub-project 3b, whose migration adds the reference.
 */
export const cafeMember = pgTable(
    "cafe_member",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        cafeId: text("cafe_id").notNull(),
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
