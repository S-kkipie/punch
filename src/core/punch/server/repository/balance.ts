import "server-only";
import { eq, sql } from "drizzle-orm";
import { type DbClient, db } from "@/server/drizzle/db";
import { punchBalanceProjection } from "@/server/drizzle/schemas/punch-schema";

export async function getBalance(
    userId: string,
    client: DbClient = db,
): Promise<number> {
    const [row] = await client
        .select({ balance: punchBalanceProjection.balance })
        .from(punchBalanceProjection)
        .where(eq(punchBalanceProjection.userId, userId));
    return row?.balance ?? 0;
}

export async function incrementBalance(
    client: DbClient,
    userId: string,
    amount: number,
): Promise<number> {
    const [row] = await client
        .insert(punchBalanceProjection)
        .values({ userId, balance: amount })
        .onConflictDoUpdate({
            target: punchBalanceProjection.userId,
            set: {
                balance: sql`${punchBalanceProjection.balance} + ${amount}`,
            },
        })
        .returning({ balance: punchBalanceProjection.balance });
    if (!row) throw new Error("incrementBalance: upsert returned no row");
    return row.balance;
}

export async function decrementBalance(
    client: DbClient,
    userId: string,
    amount: number,
): Promise<number> {
    const [row] = await client
        .update(punchBalanceProjection)
        .set({ balance: sql`${punchBalanceProjection.balance} - ${amount}` })
        .where(eq(punchBalanceProjection.userId, userId))
        .returning({ balance: punchBalanceProjection.balance });
    if (!row || row.balance < 0) {
        throw new Error("decrementBalance: balance would go negative");
    }
    return row.balance;
}
