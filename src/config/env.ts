import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
    server: {
        DATABASE_URL: z.url(),
        BETTER_AUTH_SECRET: z.string().min(32),
        // 12/24-word BIP-39 phrase; custodial signer root (spec 3a §20).
        WALLET_MASTER_MNEMONIC: z
            .string()
            .refine(
                (v) =>
                    [12, 15, 18, 21, 24].includes(v.trim().split(/\s+/).length),
                {
                    message:
                        "WALLET_MASTER_MNEMONIC must be a BIP-39 phrase (12–24 words)",
                },
            ),
    },
    client: {
        NEXT_PUBLIC_APP_URL: z.url(),
        NEXT_PUBLIC_DEMO_MODE: z
            .string()
            .optional()
            .transform((v) => v === "true"),
        NEXT_PUBLIC_DEMO_PASSWORD: z.string().min(8).optional(),
    },
    runtimeEnv: {
        DATABASE_URL: process.env.DATABASE_URL,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        WALLET_MASTER_MNEMONIC: process.env.WALLET_MASTER_MNEMONIC,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
        NEXT_PUBLIC_DEMO_PASSWORD: process.env.NEXT_PUBLIC_DEMO_PASSWORD,
    },
    emptyStringAsUndefined: true,
});
