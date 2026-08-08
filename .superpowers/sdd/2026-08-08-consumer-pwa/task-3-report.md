# Task 3 Report

## Status

DONE

## Commits

`acf5986306f6b34f4218f80c07d24bdd20e445a4` — `feat(drizzle): add consumption and punch domain tables and migration`

`a30bd890f06afbb62657d8e9fb0f837192ace1ce` — `fix(drizzle): guard punch balances against negatives`

`867403ee84f27a49eb4e22ca571cf8cd45168319` — `fix(drizzle): enforce consumer flow integrity constraints`

`0bf6999fc505bc39f36e214c9b6523fe73a5d2ee` — `test(drizzle): assert generated integrity predicates`

## Files changed

- `src/server/drizzle/schemas/consumption-schema.ts`
- `src/server/drizzle/schemas/punch-schema.ts`
- `src/server/drizzle/schemas/index.ts`
- `src/server/drizzle/db.ts`
- `src/server/drizzle/__tests__/task-3-schema.test.ts`
- `drizzle/0003_fair_human_cannonball.sql`
- `drizzle/0004_flaky_cardiac.sql`
- `drizzle/0005_exotic_payback.sql`
- `drizzle/meta/0003_snapshot.json`
- `drizzle/meta/0004_snapshot.json`
- `drizzle/meta/0005_snapshot.json`
- `drizzle/meta/_journal.json`

## Behavior and constraints implemented

- Added consumption proof, consumer transaction, and redemption request tables with all specified fields, enum values, foreign keys, delete actions, operation/signature/kind checks, unique indexes, and lookup indexes.
- Added transaction redemption-request linkage and partial unique indexes for non-null proof and redemption request IDs.
- Added voucher crawl linkage and exact source provenance check, campaign window ordering, non-negative crawl step index, and unique crawl/café step enforcement.
- Preserved the non-negative punch balance check and removed the bogus crawl balance check.
- Exported both domain schemas through the schema barrel.
- Exported `DbTransaction` and `DbClient` while preserving the existing `db` export.
- Added a schema export/table-name test covering all nine Task 3 tables.
- Generated the PostgreSQL migration and Drizzle snapshot.

## Commands and results

- `pnpm install --frozen-lockfile` — passed.
- `pnpm test -- src/server/drizzle/__tests__/task-3-schema.test.ts` — passed; 23 files and 153 tests passed (Vitest includes the configured suite despite the scoped path argument). Tests assert exact Drizzle constraint names plus normalized generated SQL bodies for every new check and both partial-index predicates.
- `pnpm typecheck` — passed.
- `pnpm db:generate` — passed; generated `drizzle/0005_exotic_payback.sql` with FK additions, partial unique indexes, and all requested checks; second generation reported no schema changes.
- `pnpm check` — passed; Biome checked 271 files.
- `git diff --check` — passed after generated artifact verification.
- `pnpm build` — initially failed because required environment variables were not set; rerun with test values for `DATABASE_URL`, `BETTER_AUTH_SECRET`, `WALLET_MASTER_MNEMONIC`, and `NEXT_PUBLIC_APP_URL` passed and produced the full Next.js route build.
- `git diff --check` — passed.

## Self-review

Reviewed generated SQL for table creation and follow-up constraint order, including all new foreign keys, partial unique indexes, checks, and preserved prior constraints. Confirmed no unsafe schema import cycle: `punch-schema` does not import `consumption-schema`; lazy callbacks resolve later declarations. Confirmed the migration is stable under a second `pnpm db:generate` invocation and row/insert exports compile through `pnpm typecheck`.

## Concerns

Next.js emits an existing workspace-root warning during build because multiple lockfiles are present. The unparameterized build requires the project environment variables; the environment-backed build passed.
