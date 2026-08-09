# Task 6 report

## Status

PART A VERIFIED LIVE.

## Implemented before block

- Added and ran TDD coverage for the local-chain guard and deterministic historical schedule in `src/core/chain/server/bootstrap-local/__tests__/historical-consumptions.test.ts`.
- Added `assertLocalChain31337` and a deterministic schedule helper in `src/core/chain/server/bootstrap-local/historical-consumptions.ts`.
- Extracted worker error redaction to `src/core/worker/error-redaction.ts`; added tests and kept the existing worker suite green.
- Added operator wallet address collection to the bootstrap repository and idempotent authorization/verification seams to bootstrap service.
- Added a serial child-process demo runner in `scripts/demo-local.ts` and package entries for `demo:local` and `chain:seed-history`.
- Added a phase-ordering test for the demo runner.
- Implemented `seedHistoricalConsumptions` using real typed-data signatures from the consumer and café owner custodial accounts, `ConsumptionLog.recordConsumption`, receipt status checks, Anvil daily time advancement, credit and reserve preconditions, target-café `PunchIssued` event exclusion, and final `PunchVault.balanceOf === 11` verification.
- Wired `scripts/bootstrap-local.ts --seed-history` to bootstrap cafés and then seed the demo consumer against `esquina-sur`.
- Added a gated live-chain test that checks eleven returned receipts and refuses a second seed.

## Verification

Passing:

- `pnpm vitest run src/core/chain/server/bootstrap-local/__tests__ src/core/worker/__tests__/worker.test.ts` — 19 passed, 1 gated live test skipped without `PUNCH_RUN_LIVE_CHAIN=1`.
- `pnpm typecheck`
- `pnpm biome check --write scripts/bootstrap-local.ts src/core/chain/server/bootstrap-local/historical-consumptions.ts`
- `pnpm chain:deploy` completed against the available local RPC and deployed all contracts; generated addresses were restored afterward.

## Live verification transcript (2026-08-09)

The coordinator-provided Anvil was reused at `127.0.0.1:8545`; no second Anvil was started. The isolated database URL was used with `DATABASE_SSL=false`.

1. First `pnpm db:seed` exposed a stale pre-existing walletless integration user and failed with:

   `Error: seed verification failed: second-consumer-fa8fba72-0215-4b3c-9592-66b3ebc31dec@integration.invalid has no wallet`

   That stale integration-only row was removed, then `pnpm db:seed` passed with `Seed OK — all users have wallets.`
2. `pnpm chain:deploy` passed and deployed all seven contracts.
3. `pnpm chain:bootstrap-local` passed with `local bootstrap complete`.
4. The first live test invocation exposed an invalid test fixture using the literal IDs `demo-consumer` and `esquina-sur`; it failed with `historical seeding consumer wallet is missing`. The test was corrected to resolve the seeded consumer by email and target café by slug, and to fail clearly if `db:seed` was not run.
5. Final command:

   `DATABASE_URL=postgres://punch:punch@localhost:5432/punch_task2_integration DATABASE_SSL=false CHAIN_ENV=local CHAIN_RPC_URL=http://127.0.0.1:8545 WALLET_MASTER_MNEMONIC=[test-only] PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1 pnpm vitest run src/core/chain/server/bootstrap-local/__tests__/historical-consumptions.live.test.ts`

   Output: `1 passed (1)`, test duration `522ms`.

The passing live test submitted eleven real `ConsumptionLog.recordConsumption` transactions, asserted eleven unique receipt hashes, exercised the on-chain final balance assertion (`PunchVault.balanceOf === 11`), exercised target-café event exclusion, and verified a second run refuses to double-seed. The implementation refuses non-31337 or production-mode execution and uses no mint/projection shortcuts. Part B demo orchestration remains intentionally untouched.
