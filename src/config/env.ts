import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
    server: {
        DATABASE_URL: z.url(),
        DATABASE_SSL: z
            .enum(["true", "false"])
            .optional()
            .transform((value) => value !== "false"),
        BETTER_AUTH_SECRET: z.string().min(32),
        // 12/24-word BIP-39 phrase; custodial signer root (spec 3a §20).
        WALLET_MASTER_MNEMONIC: z
            .string()
            .refine((v) => validateMnemonic(v.trim(), wordlist), {
                message:
                    "WALLET_MASTER_MNEMONIC must be a valid BIP-39 mnemonic (12–24 words)",
            }),
        CHAIN_ENV: z.enum(["local", "arbitrumSepolia"]).default("local"),
        CHAIN_RPC_URL: z.url().default("http://127.0.0.1:8545"),
        RELAYER_WALLET_INDEX: z.coerce.number().int().nonnegative().default(0),
        CONSUMER_CHAIN_MODE: z.enum(["mock", "local"]).optional(),
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
        DATABASE_SSL: process.env.DATABASE_SSL,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        WALLET_MASTER_MNEMONIC: process.env.WALLET_MASTER_MNEMONIC,
        CHAIN_ENV: process.env.CHAIN_ENV,
        CHAIN_RPC_URL: process.env.CHAIN_RPC_URL,
        RELAYER_WALLET_INDEX: process.env.RELAYER_WALLET_INDEX,
        CONSUMER_CHAIN_MODE: process.env.CONSUMER_CHAIN_MODE,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
        NEXT_PUBLIC_DEMO_PASSWORD: process.env.NEXT_PUBLIC_DEMO_PASSWORD,
    },
    emptyStringAsUndefined: true,
});
