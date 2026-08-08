import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { cafe, cafeMember } from "@/server/drizzle/schemas/cafe-schema";

export function listCafesByMember(userId: string) {
    return db
        .select({ cafe })
        .from(cafeMember)
        .innerJoin(cafe, eq(cafe.id, cafeMember.cafeId))
        .where(eq(cafeMember.userId, userId))
        .orderBy(asc(cafe.id));
}
