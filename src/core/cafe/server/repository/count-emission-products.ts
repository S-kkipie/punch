import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { cafeProduct } from "@/server/drizzle/schemas/cafe-schema";

export async function countEmissionProducts(cafeId: string): Promise<number> {
    const [row] = await db
        .select({ n: count() })
        .from(cafeProduct)
        .where(
            and(
                eq(cafeProduct.cafeId, cafeId),
                eq(cafeProduct.type, "emission"),
            ),
        );
    return Number(row?.n ?? 0);
}
