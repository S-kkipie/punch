import { drizzle } from "drizzle-orm/node-postgres";
import { ServerConfig } from "@/config/server-config";
import * as schema from "@/server/drizzle/schemas";

const databaseHost = new URL(ServerConfig.databaseURL).hostname;
const isLocalDatabase =
    databaseHost === "localhost" || databaseHost === "127.0.0.1";

export const db = drizzle({
    connection: {
        connectionString: ServerConfig.databaseURL,
        ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
    },
    schema,
    casing: "snake_case",
});
