import { drizzle } from "drizzle-orm/node-postgres";
import { ServerConfig } from "@/config/server-config";
import * as schema from "@/server/drizzle/schemas";

export const db = drizzle({
    connection: {
        connectionString: ServerConfig.databaseURL,
        ssl: ServerConfig.databaseSSL ? { rejectUnauthorized: false } : false,
    },
    schema,
    casing: "snake_case",
});

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = typeof db | DbTransaction;
