import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { ServerConfig } from "@/config/server-config";

const pool = new Pool({
    connectionString: ServerConfig.databaseURL,
    ssl: ServerConfig.databaseSSL ? { rejectUnauthorized: false } : false,
});

await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
await pool.end();

console.log("migrations applied");
