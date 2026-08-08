import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import {
    type CafeRow,
    cafe,
    type NewCafeRow,
} from "@/server/drizzle/schemas/cafe-schema";

export async function updateCafe(
    cafeId: string,
    patch: Partial<NewCafeRow>,
): Promise<CafeRow> {
    const [row] = await db
        .update(cafe)
        .set(patch)
        .where(eq(cafe.id, cafeId))
        .returning();
    return row;
}
