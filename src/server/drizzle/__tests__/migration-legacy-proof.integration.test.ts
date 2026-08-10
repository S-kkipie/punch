import {
    cpSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { drizzleRoot } from "../migration-path";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
const baseUrl = process.env.DATABASE_URL ?? "";
const createdDatabases: string[] = [];
const tempFolders: string[] = [];

function parseDatabaseUrl(url: string) {
    const parsed = new URL(url);
    parsed.pathname = "/postgres";
    return {
        adminUrl: parsed.toString(),
        hostUrl: url,
    };
}

function buildDatabaseUrl(base: string, databaseName: string) {
    const parsed = new URL(base);
    parsed.pathname = `/${databaseName}`;
    return parsed.toString();
}

function copyMigrationSet(lastIndex: number) {
    const folder = mkdtempSync(join(tmpdir(), "punch-migrate-"));
    tempFolders.push(folder);
    cpSync(join(drizzleRoot, "meta"), join(folder, "meta"), {
        recursive: true,
    });

    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    for (const metaFile of readdirSync(join(folder, "meta"))) {
        if (metaFile === "_journal.json") continue;
        const snapshotIndex = Number(metaFile.slice(0, 4));
        if (Number.isFinite(snapshotIndex) && snapshotIndex > lastIndex) {
            rmSync(join(folder, "meta", metaFile));
        }
    }

    for (const sqlFile of readdirSync(drizzleRoot)) {
        if (!sqlFile.endsWith(".sql")) continue;
        const fileIndex = Number(sqlFile.slice(0, 4));
        if (Number.isFinite(fileIndex) && fileIndex <= lastIndex) {
            cpSync(join(drizzleRoot, sqlFile), join(folder, sqlFile));
        }
    }

    return folder;
}

async function migrateDatabase(databaseUrl: string, migrationsFolder: string) {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false });
    try {
        await migrate(drizzle(pool), { migrationsFolder });
    } finally {
        await pool.end();
    }
}

describeIntegration("legacy proof migration", () => {
    afterEach(async () => {
        for (const folder of tempFolders.splice(0))
            rmSync(folder, { recursive: true, force: true });
        if (!baseUrl) return;
        const { adminUrl } = parseDatabaseUrl(baseUrl);
        const client = new Client({ connectionString: adminUrl, ssl: false });
        await client.connect();
        try {
            for (const dbName of createdDatabases.splice(0)) {
                await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
            }
        } finally {
            await client.end();
        }
    });

    it("cleans legacy duplicate active PUNCH requests before the unique index", async () => {
        expect(baseUrl).toBeTruthy();
        const dbName = `punch_dupes_${crypto.randomUUID().replaceAll("-", "")}`;
        createdDatabases.push(dbName);
        const { adminUrl } = parseDatabaseUrl(baseUrl);
        const admin = new Client({ connectionString: adminUrl, ssl: false });
        await admin.connect();
        await admin.query(`CREATE DATABASE "${dbName}"`);
        await admin.end();
        const databaseUrl = buildDatabaseUrl(baseUrl, dbName);
        await migrateDatabase(databaseUrl, copyMigrationSet(13));
        const client = new Client({
            connectionString: databaseUrl,
            ssl: false,
        });
        await client.connect();
        try {
            await client.query(`
                INSERT INTO "user" (id, name, email)
                VALUES ('dup-user', 'Duplicate User', 'dup-user@example.test');
                INSERT INTO cafe (id, name, slug)
                VALUES ('dup-cafe', 'Duplicate Cafe', 'dup-cafe');
                INSERT INTO cafe_product (id, cafe_id, name, price_soles, type, approval_status, active)
                VALUES ('dup-product', 'dup-cafe', 'Reward', '12.00', 'reward', 'approved', true);
                INSERT INTO redemption_request
                    (id, kind, consumer_user_id, cafe_id, product_id, status, created_at, updated_at)
                VALUES
                    ('dup-old', 'punch_reward', 'dup-user', 'dup-cafe', 'dup-product', 'approved', now() - interval '1 hour', now()),
                    ('dup-new', 'punch_reward', 'dup-user', 'dup-cafe', 'dup-product', 'pending', now(), now());
            `);
        } finally {
            await client.end();
        }
        await migrateDatabase(databaseUrl, drizzleRoot);
        const verify = new Client({
            connectionString: databaseUrl,
            ssl: false,
        });
        await verify.connect();
        try {
            const result = await verify.query(
                `SELECT id, status, rejection_reason FROM redemption_request WHERE id IN ('dup-old', 'dup-new') ORDER BY id`,
            );
            expect(result.rows).toEqual([
                { id: "dup-new", status: "pending", rejection_reason: null },
                {
                    id: "dup-old",
                    status: "rejected",
                    rejection_reason: "superseded_by_newer_active_request",
                },
            ]);
        } finally {
            await verify.end();
        }
    });

    it("reclassifies legacy confirmed proofs without purchase orders and completes migration", async () => {
        expect(baseUrl).toBeTruthy();
        const dbName = `punch_legacy_${crypto.randomUUID().replaceAll("-", "")}`;
        createdDatabases.push(dbName);

        const { adminUrl } = parseDatabaseUrl(baseUrl);
        const admin = new Client({ connectionString: adminUrl, ssl: false });
        await admin.connect();
        await admin.query(`CREATE DATABASE "${dbName}"`);
        await admin.end();

        const dbUrl = buildDatabaseUrl(baseUrl, dbName);
        await migrateDatabase(dbUrl, copyMigrationSet(9));

        const client = new Client({ connectionString: dbUrl, ssl: false });
        await client.connect();
        try {
            await client.query(
                `INSERT INTO "user" (id, name, email, updated_at) VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
                [
                    "barista-1",
                    "Barista",
                    "barista-1@example.invalid",
                    "consumer-1",
                    "Consumer",
                    "consumer-1@example.invalid",
                ],
            );
            await client.query(
                `INSERT INTO cafe (id, name, slug, onboarding_status) VALUES ($1, $2, $3, 'approved')`,
                ["cafe-1", "Cafe", "cafe-1"],
            );
            await client.query(
                `INSERT INTO cafe_product (id, cafe_id, name, price_soles, type, approval_status, active) VALUES ($1, $2, $3, $4, 'emission', 'approved', true)`,
                ["product-1", "cafe-1", "Latte", "8.00"],
            );
            await client.query(
                `INSERT INTO consumption_proof (id, cafe_id, product_id, issued_by_user_id, consumer_user_id, amount_centimos, receipt_hash, nonce, cafe_signature, consumer_signature, status, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed', now() + interval '10 minutes')`,
                [
                    "legacy-proof-1",
                    "cafe-1",
                    "product-1",
                    "barista-1",
                    "consumer-1",
                    800,
                    `0x${"11".repeat(32)}`,
                    "123",
                    `0x${"22".repeat(32)}`,
                    `0x${"33".repeat(32)}`,
                ],
            );
        } finally {
            await client.end();
        }

        await migrateDatabase(dbUrl, drizzleRoot);

        const verification = new Client({
            connectionString: dbUrl,
            ssl: false,
        });
        await verification.connect();
        try {
            const { rows } = await verification.query(
                `SELECT status, consumer_user_id, purchase_order_id, cafe_signature, consumer_signature, receipt_hash, nonce FROM consumption_proof WHERE id = $1`,
                ["legacy-proof-1"],
            );
            expect(rows).toEqual([
                {
                    status: "issued",
                    consumer_user_id: null,
                    purchase_order_id: null,
                    cafe_signature: null,
                    consumer_signature: null,
                    receipt_hash: null,
                    nonce: null,
                },
            ]);
        } finally {
            await verification.end();
        }
    });
});
