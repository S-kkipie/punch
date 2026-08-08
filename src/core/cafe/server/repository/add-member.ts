import "server-only";
import { db } from "@/server/drizzle/db";
import {
    type CafeMemberRole,
    type CafeMemberRow,
    cafeMember,
} from "@/server/drizzle/schemas/cafe-schema";

export async function addMember(
    userId: string,
    cafeId: string,
    role: CafeMemberRole,
): Promise<CafeMemberRow | undefined> {
    const [row] = await db
        .insert(cafeMember)
        .values({ userId, cafeId, role })
        .onConflictDoNothing()
        .returning();
    return row;
}
