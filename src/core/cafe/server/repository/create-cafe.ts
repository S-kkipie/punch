import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/server/drizzle/db";
import { type CafeRow, cafe } from "@/server/drizzle/schemas/cafe-schema";
import { slugify } from "./utils";

export async function createCafe(values: {
    name: string;
    description?: string | null;
}): Promise<CafeRow> {
    const base = slugify(values.name) || "cafe";
    try {
        const [row] = await db
            .insert(cafe)
            .values({ ...values, slug: base })
            .returning();
        return row;
    } catch {
        const [row] = await db
            .insert(cafe)
            .values({ ...values, slug: `${base}-${nanoid(4)}` })
            .returning();
        return row;
    }
}
