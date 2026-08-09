import { z } from "zod";
import { env } from "@/config/env";

export type ConsumerChainMode = "mock" | "local";

export function parseConsumerChainMode(
    value: string | undefined,
    nodeEnv = process.env.NODE_ENV,
): ConsumerChainMode {
    return z
        .enum(["mock", "local"])
        .default(nodeEnv === "test" ? "mock" : "local")
        .parse(value);
}

export const ServerConfig = {
    databaseURL: env.DATABASE_URL,
    databaseSSL: env.DATABASE_SSL,
    baseUrl: env.NEXT_PUBLIC_APP_URL,
    betterAuthSecret: env.BETTER_AUTH_SECRET,
    info: {
        name: "Hackaton Starter API",
        version: "1.0.0",
        description: "Hackaton Starter API",
    },
    /** Single sanctioned read of the Node built-in. */
    isProduction: process.env.NODE_ENV === "production",
    isDevelopment: process.env.NODE_ENV === "development",
    consumerChainMode: parseConsumerChainMode(env.CONSUMER_CHAIN_MODE),
} as const;
