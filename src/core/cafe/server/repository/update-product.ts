import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import {
    type CafeProductRow,
    cafeProduct,
    type NewCafeProductRow,
} from "@/server/drizzle/schemas/cafe-schema";
export async function updateProduct(
    id: string,
    patch: Partial<NewCafeProductRow>,
): Promise<CafeProductRow> {
    const [row] = await db
        .update(cafeProduct)
        .set(patch)
        .where(eq(cafeProduct.id, id))
        .returning();
    return row;
}
