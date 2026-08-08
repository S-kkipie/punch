import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { cafe, cafeMember } from "@/server/drizzle/schemas/cafe-schema";

export async function listCafesByUser(userId: string) {
    return db
        .select({ cafe })
        .from(cafeMember)
        .innerJoin(cafe, eq(cafe.id, cafeMember.cafeId))
        .where(
            and(eq(cafeMember.userId, userId), eq(cafeMember.role, "owner")),
        );
}
