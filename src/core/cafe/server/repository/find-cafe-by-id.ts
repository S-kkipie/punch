import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { type CafeRow, cafe } from "@/server/drizzle/schemas/cafe-schema";

export async function findCafeById(id: string): Promise<CafeRow | null> {
    const [row] = await db.select().from(cafe).where(eq(cafe.id, id)).limit(1);
    return row ?? null;
}
