import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import {
    type CafeProductRow,
    cafeProduct,
} from "@/server/drizzle/schemas/cafe-schema";
export async function listPendingProducts(): Promise<CafeProductRow[]> {
    return db
        .select()
        .from(cafeProduct)
        .where(eq(cafeProduct.approvalStatus, "pending"));
}
