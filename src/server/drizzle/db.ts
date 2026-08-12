import { drizzle } from "drizzle-orm/node-postgres";
import { ServerConfig } from "@/config/server-config";
import * as schema from "@/server/drizzle/schemas";

type Db = ReturnType<
    typeof drizzle<typeof schema, ReturnType<typeof drizzle>["$client"]>
>;

let instance: Db | null = null;

/**
 * La conexión se abre en el primer uso, no al importar el módulo. En Cloudflare
 * Workers la cadena de conexión llega por un binding que solo existe dentro del
 * handler, así que un pool creado en import time se quedaba con la variable de
 * entorno equivocada y moría con "Connection terminated unexpectedly".
 */
function client(): Db {
    if (instance) return instance;
    // `ServerConfig` se congela al importar `@/config/env`, antes de que el
    // handler de Workers pueda leer su binding: por eso se relee `process.env`,
    // que el worker sí puede sobreescribir en runtime. En Node ambos coinciden.
    const connectionString =
        process.env.DATABASE_URL ?? ServerConfig.databaseURL;
    const useSsl =
        process.env.DATABASE_SSL === undefined
            ? ServerConfig.databaseSSL
            : process.env.DATABASE_SSL === "true";
    instance = drizzle({
        connection: {
            connectionString,
            ssl: useSsl ? { rejectUnauthorized: false } : false,
        },
        schema,
        casing: "snake_case",
    }) as Db;
    return instance;
}

export const db = new Proxy({} as Db, {
    get: (_target, property, receiver) =>
        Reflect.get(client(), property, receiver),
    has: (_target, property) => property in client(),
});

export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbClient = Db | DbTransaction;
