import { eq } from "drizzle-orm";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import {
    cafe,
    cafeMember,
    cafeProduct,
} from "@/server/drizzle/schemas/cafe-schema";

export const DEMO_ACCOUNTS = [
    { email: "demo-ops@punch.pe", name: "Operaciones PUNCH", isOps: true },
    { email: "brujula@punch.pe", name: "Brújula Café", isOps: false },
    { email: "patio9@punch.pe", name: "Patio 9", isOps: false },
    { email: "nube@punch.pe", name: "Nube Tostada", isOps: false },
    { email: "esquinasur@punch.pe", name: "Esquina Sur", isOps: false },
    { email: "demo-consumer@punch.pe", name: "Consumidor Demo", isOps: false },
] as const;

const SEED_CAFES = [
    {
        slug: "brujula-cafe",
        name: "Brújula Café",
        ownerEmail: "brujula@punch.pe",
        district: "Miraflores",
        address: "Av. Larco 345, Miraflores",
        description: "Café de especialidad frente al parque.",
        status: "approved" as const,
        products: [
            { name: "Espresso", type: "emission", priceSoles: "8.00" },
            { name: "Latte", type: "emission", priceSoles: "12.00" },
            {
                name: "Cappuccino clásico",
                type: "reward",
                priceSoles: "11.00",
                cogsSoles: "2.80",
            },
        ],
    },
    {
        slug: "patio-9",
        name: "Patio 9",
        ownerEmail: "patio9@punch.pe",
        district: "Barranco",
        address: "Jr. Unión 910, Barranco",
        description: "Patio interior, tuestes locales.",
        status: "approved" as const,
        products: [
            { name: "Americano", type: "emission", priceSoles: "9.00" },
            { name: "Flat white", type: "emission", priceSoles: "13.00" },
            {
                name: "Filtrado V60",
                type: "reward",
                priceSoles: "12.00",
                cogsSoles: "3.00",
            },
        ],
    },
    {
        slug: "nube-tostada",
        name: "Nube Tostada",
        ownerEmail: "nube@punch.pe",
        district: "San Isidro",
        address: "Calle Los Pinos 120, San Isidro",
        description: "Micro-tostaduría de barrio.",
        status: "approved" as const,
        products: [
            { name: "Espresso doble", type: "emission", priceSoles: "10.00" },
            {
                name: "Cold brew",
                type: "reward",
                priceSoles: "12.00",
                cogsSoles: "2.50",
            },
        ],
    },
    {
        slug: "esquina-sur",
        name: "Esquina Sur",
        ownerEmail: "esquinasur@punch.pe",
        district: "Surquillo",
        address: "Av. Angamos Este 550, Surquillo",
        description: "Esquina de barrio, café honesto.",
        status: "approved" as const,
        products: [
            { name: "Café pasado", type: "emission", priceSoles: "7.00" },
            {
                name: "Cortado",
                type: "reward",
                priceSoles: "9.00",
                cogsSoles: "2.20",
            },
        ],
    },
    {
        slug: "quinto-cafe-demo",
        name: "Quinto Café (en revisión)",
        ownerEmail: "demo-consumer@punch.pe",
        district: "Lince",
        address: "Av. Arequipa 2020, Lince",
        description: "Café de demo para la cola de ops.",
        status: "submitted" as const,
        products: [{ name: "Espresso", type: "emission", priceSoles: "8.50" }],
    },
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

    for (const seedCafe of SEED_CAFES) {
        const [existingCafe] = await db
            .select({ id: cafe.id })
            .from(cafe)
            .where(eq(cafe.slug, seedCafe.slug));
        if (existingCafe) {
            console.log(`= ${seedCafe.slug} already seeded`);
            continue;
        }

        const [owner] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, seedCafe.ownerEmail));
        if (!owner) {
            throw new Error(
                `seed failed: owner ${seedCafe.ownerEmail} does not exist`,
            );
        }

        const [insertedCafe] = await db
            .insert(cafe)
            .values({
                slug: seedCafe.slug,
                name: seedCafe.name,
                district: seedCafe.district,
                address: seedCafe.address,
                description: seedCafe.description,
                onboardingStatus: seedCafe.status,
                contactPhone: "+51 900 000 000",
                ruc: `2060000000${SEED_CAFES.indexOf(seedCafe) + 1}`,
            })
            .returning({ id: cafe.id });

        if (!insertedCafe) {
            throw new Error(`seed failed: could not insert ${seedCafe.slug}`);
        }

        await db
            .insert(cafeMember)
            .values({
                userId: owner.id,
                cafeId: insertedCafe.id,
                role: "owner",
            })
            .onConflictDoNothing();

        await db.insert(cafeProduct).values(
            seedCafe.products.map((product) => ({
                cafeId: insertedCafe.id,
                name: product.name,
                type: product.type,
                priceSoles: product.priceSoles,
                ...("cogsSoles" in product
                    ? { cogsSoles: product.cogsSoles }
                    : {}),
                approvalStatus:
                    seedCafe.status === "approved"
                        ? ("approved" as const)
                        : ("pending" as const),
            })),
        );
        console.log(`+ seeded ${seedCafe.slug}`);
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
