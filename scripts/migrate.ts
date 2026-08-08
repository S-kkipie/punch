import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
}
const databaseHost = new URL(databaseUrl).hostname;
const isLocalDatabase =
    databaseHost === "localhost" || databaseHost === "127.0.0.1";

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});

await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
await pool.end();

console.log("migrations applied");
