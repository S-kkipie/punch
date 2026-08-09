import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const integrationDatabaseUrl = process.env.DATABASE_URL;
if (runIntegration && !integrationDatabaseUrl) {
    throw new Error("PUNCH_RUN_INTEGRATION=1 requires DATABASE_URL to be set");
}

export default defineConfig({
    resolve: {
        alias: {
            "server-only": r("./src/test/server-only-stub.ts"),
            "@": r("./src"),
        },
    },
    css: {
        postcss: { plugins: [] },
    },
    test: {
        environment: "node",
        globals: true,
        include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
        env: {
            DATABASE_URL:
                integrationDatabaseUrl ??
                "postgres://user:pass@localhost:5432/app",
            BETTER_AUTH_SECRET: "test-secret-least-thirty-two-chars-long",
            NEXT_PUBLIC_APP_URL: "http://localhost:3000",
            WALLET_MASTER_MNEMONIC:
                "test test test test test test test test test test test junk",
        },
    },
});
