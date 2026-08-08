import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";

export async function listApprovedCafes() {
    return db.select().from(cafe).where(eq(cafe.onboardingStatus, "approved"));
}
