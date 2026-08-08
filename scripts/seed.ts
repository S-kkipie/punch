import { eq } from "drizzle-orm";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";

export const DEMO_ACCOUNTS = [
    { email: "demo-ops@punch.pe", name: "Operaciones PUNCH", isOps: true },
    { email: "brujula@punch.pe", name: "Brújula Café", isOps: false },
    { email: "patio9@punch.pe", name: "Patio 9", isOps: false },
    { email: "nube@punch.pe", name: "Nube Tostada", isOps: false },
    { email: "esquinasur@punch.pe", name: "Esquina Sur", isOps: false },
    { email: "demo-consumer@punch.pe", name: "Consumidor Demo", isOps: false },
] as const;

async function main() {
    const password = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
    if (!password) {
        throw new Error(
            "NEXT_PUBLIC_DEMO_PASSWORD is required to seed demo accounts",
        );
    }
    for (const acct of DEMO_ACCOUNTS) {
        const [existing] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, acct.email));
        if (existing) {
            console.log(`= ${acct.email} already seeded`);
            continue;
        }
        // Better Auth server API — fires databaseHooks, so wallet gets assigned.
        await auth.api.signUpEmail({
            body: { email: acct.email, password, name: acct.name },
        });
        if (acct.isOps) {
            await db
                .update(user)
                .set({ isOps: true })
                .where(eq(user.email, acct.email));
        }
        console.log(`+ seeded ${acct.email}`);
    }
    const rows = await db
        .select({ email: user.email, walletAddress: user.walletAddress })
        .from(user);
    for (const r of rows) {
        if (!r.walletAddress) {
            throw new Error(
                `seed verification failed: ${r.email} has no wallet`,
            );
        }
    }
    console.log("Seed OK — all users have wallets.");
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
