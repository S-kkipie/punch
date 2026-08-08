import "server-only";
import { and, eq, sql } from "drizzle-orm";
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

export class BalanceRepositoryError extends Error {
    constructor(
        public code: "INVALID_AMOUNT" | "INSUFFICIENT_BALANCE",
        message: string,
    ) {
        super(message);
        this.name = "BalanceRepositoryError";
    }
}

function assertValidAmount(amount: number): void {
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
        throw new BalanceRepositoryError(
            "INVALID_AMOUNT",
            `Balance amount must be a positive finite integer: ${amount}`,
        );
    }
}

export async function incrementBalance(
    client: DbClient,
    userId: string,
    amount: number,
): Promise<number> {
    assertValidAmount(amount);
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
    assertValidAmount(amount);
    const [row] = await client
        .update(punchBalanceProjection)
        .set({ balance: sql`${punchBalanceProjection.balance} - ${amount}` })
        .where(
            and(
                eq(punchBalanceProjection.userId, userId),
                sql`${punchBalanceProjection.balance} >= ${amount}`,
            ),
        )
        .returning({ balance: punchBalanceProjection.balance });
    if (!row) {
        throw new BalanceRepositoryError(
            "INSUFFICIENT_BALANCE",
            "Balance is missing or insufficient for decrement",
        );
    }
    return row.balance;
}
