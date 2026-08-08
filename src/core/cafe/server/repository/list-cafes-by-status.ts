import "server-only";
import { eq } from "drizzle-orm";
import type { CafeOnboardingStatus } from "@/core/cafe/domain/types";
import { db } from "@/server/drizzle/db";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";

export async function listCafesByStatus(status: CafeOnboardingStatus) {
    return db.select().from(cafe).where(eq(cafe.onboardingStatus, status));
}
