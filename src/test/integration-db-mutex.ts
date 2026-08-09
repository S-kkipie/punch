import { Client } from "pg";
import { afterEach, beforeEach } from "vitest";

const LOCK_KEY_1 = 20_260_808;
const LOCK_KEY_2 = 1;

export function installIntegrationDbMutex() {
    if (process.env.PUNCH_RUN_INTEGRATION !== "1") return;

    let client: Client | null = null;

    beforeEach(async () => {
        client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        await client.query("SELECT pg_advisory_lock($1, $2)", [
            LOCK_KEY_1,
            LOCK_KEY_2,
        ]);
    });

    afterEach(async () => {
        if (!client) return;
        try {
            await client.query("SELECT pg_advisory_unlock($1, $2)", [
                LOCK_KEY_1,
                LOCK_KEY_2,
            ]);
        } finally {
            await client.end();
            client = null;
        }
    });
}
