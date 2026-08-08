import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";

export type UserWallet = {
    walletIndex: number | null;
    walletAddress: string | null;
};

export async function findUserWallet(
    userId: string,
): Promise<UserWallet | null> {
    const [row] = await db
        .select({
            walletIndex: user.walletIndex,
            walletAddress: user.walletAddress,
        })
        .from(user)
        .where(eq(user.id, userId));
    return row ?? null;
}

export async function claimWalletIndex(): Promise<number> {
    const result = await db.execute<{ idx: number }>(
        sql`select nextval('wallet_index_seq')::int as idx`,
    );
    return result.rows[0].idx;
}

/** Sets wallet fields only if still unassigned. Returns false on lost race. */
export async function setUserWallet(
    userId: string,
    walletIndex: number,
    walletAddress: string,
): Promise<boolean> {
    const updated = await db
        .update(user)
        .set({ walletIndex, walletAddress })
        .where(and(eq(user.id, userId), isNull(user.walletIndex)))
        .returning({ id: user.id });
    return updated.length > 0;
}
