import "server-only";
import { db } from "@/server/drizzle/db";
import {
    type CafeProductRow,
    cafeProduct,
    type NewCafeProductRow,
} from "@/server/drizzle/schemas/cafe-schema";
export async function createProduct(
    input: NewCafeProductRow,
): Promise<CafeProductRow> {
    const [row] = await db.insert(cafeProduct).values(input).returning();
    return row;
}
