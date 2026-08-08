import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getLogger } from "@logtape/logtape";
import { APIError, betterAuth } from "better-auth";
import { openAPI } from "better-auth/plugins";
import { headers } from "next/headers";
import { cache } from "react";
import { ServerConfig } from "@/config/server-config";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { db } from "@/server/drizzle/db";
import * as authSchema from "@/server/drizzle/schemas/auth-schema";

const logger = getLogger(["server", "auth"]);

export const auth = betterAuth({
    baseURL: ServerConfig.baseUrl,
    basePath: "/api/v1/auth",
    secret: ServerConfig.betterAuthSecret,
    session: { freshAge: 0 },
    emailAndPassword: {
        enabled: true,
        // Starter keeps verification off so sign-up works with no email provider.
        requireEmailVerification: false,
    },
    plugins: [
        openAPI({ disableDefaultReference: !ServerConfig.isDevelopment }),
    ],
    user: {
        additionalFields: {
            isOps: { type: "boolean", defaultValue: false, input: false },
        },
    },
    databaseHooks: {
        user: {
            create: {
                after: async (createdUser) => {
                    try {
                        await assignWallet(createdUser.id);
                    } catch (e) {
                        // Signup must not fail if wallet assignment hiccups;
                        // assignWallet is idempotent and re-runnable (seed/backfill).
                        logger.error(
                            "wallet assignment failed for {userId}: {error}",
                            {
                                userId: createdUser.id,
                                error: e,
                            },
                        );
                    }
                },
            },
        },
    },
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
});

/**
 * React cache()-wrapped session read for server components / guards.
 * Swallows errors → null so callers can treat it as a null-tolerant read.
 */
export const authenticate = cache(async () => {
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        return session
            ? { user: session.user, session: session.session }
            : null;
    } catch (e) {
        if (e instanceof APIError) {
            logger.warn("Auth API error: {error}", { error: e });
            return null;
        }
        logger.error("Authentication error: {error}", { error: e });
        return null;
    }
});
