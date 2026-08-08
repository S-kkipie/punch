import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import {
    type CafeMemberRow,
    cafeMember,
} from "@/server/drizzle/schemas/cafe-schema";

export async function findMembership(
    userId: string,
    cafeId: string,
): Promise<CafeMemberRow | null> {
    const [row] = await db
        .select()
        .from(cafeMember)
        .where(
            and(eq(cafeMember.userId, userId), eq(cafeMember.cafeId, cafeId)),
        );
    return row ?? null;
}
