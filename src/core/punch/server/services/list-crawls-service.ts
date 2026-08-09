import "server-only";
import { asc, eq } from "drizzle-orm";
import type { CoffeeCrawl } from "@/core/punch/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import {
    coffeeCrawl,
    coffeeCrawlStep,
} from "@/server/drizzle/schemas/punch-schema";

const toCrawl = (
    row: typeof coffeeCrawl.$inferSelect,
    steps: (typeof coffeeCrawlStep.$inferSelect)[],
): CoffeeCrawl => ({
    id: row.id,
    name: row.name,
    expiresAt: row.expiresAt.toISOString(),
    steps: steps.map((step) => ({
        stepIndex: step.stepIndex,
        cafeId: step.cafeId,
    })),
});

async function readCrawl(id: string) {
    const [row] = await db
        .select()
        .from(coffeeCrawl)
        .where(eq(coffeeCrawl.id, id));
    if (!row) return null;
    const steps = await db
        .select()
        .from(coffeeCrawlStep)
        .where(eq(coffeeCrawlStep.crawlId, id))
        .orderBy(asc(coffeeCrawlStep.stepIndex));
    return toCrawl(row, steps);
}

export async function listCrawlsService(): AsyncAppResult<CoffeeCrawl[]> {
    try {
        const rows = await db
            .select()
            .from(coffeeCrawl)
            .where(eq(coffeeCrawl.active, true));
        const result: CoffeeCrawl[] = [];
        for (const row of rows) {
            const steps = await db
                .select()
                .from(coffeeCrawlStep)
                .where(eq(coffeeCrawlStep.crawlId, row.id))
                .orderBy(asc(coffeeCrawlStep.stepIndex));
            result.push(toCrawl(row, steps));
        }
        return ok(result);
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}

export async function getCrawlService(id: string): AsyncAppResult<CoffeeCrawl> {
    try {
        const result = await readCrawl(id);
        return result
            ? ok(result)
            : err(AppErrors.notFound({ targets: ["id"] }));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
