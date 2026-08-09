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

## Part B live verification transcript (2026-08-09)

A fresh database `punch_demo_local_agent3` was created. The existing Anvil was stopped before the run; `demo:local` spawned its own Anvil on `127.0.0.1:8545`. The command used `DATABASE_URL=postgres://punch:punch@localhost:5432/punch_demo_local_agent3 DATABASE_SSL=false CHAIN_ENV=local CHAIN_RPC_URL=http://127.0.0.1:8545` and the test-only mnemonic via the shell environment.

The real terminal milestones from `pnpm demo:local` were:

```text
migrations applied
Seed OK — all users have wallets.
31337
local bootstrap complete
historical seeding complete: 11 receipts
local chain indexed from block zero
local chain reconciliation green
✓ Ready in 291ms
```

The projection query against the fresh database returned:

```json
{"balance":11,"status":true}
```

where `status: true` means `projection_status.paused = false`. The chain cursor was reconciled through block 55 in the first clean run and the same milestones were reproduced in the post-cleanup run.

For shutdown verification, the live demo parent received `SIGINT`. The observed process tree contained the demo parent, Anvil, worker shell/process, and Next shell/process before the signal; after five seconds `pgrep -af 'demo-local|anvil|next dev|scripts/worker'` returned no demo child processes. The command's final output contained two expected pnpm `ELIFECYCLE` lines from signal-propagated child exits, and the background command completed with exit code 0.

The orchestration now performs database `select 1` preflight before spawning Anvil, polls JSON-RPC `eth_chainId` until it sees 31337, runs setup phases serially, sanitizes piped child output (including full mnemonic and 64-byte private-key lines), uses detached process groups for cleanup, indexes from block zero, requires reconciliation to be unpaused, and only then starts worker and app together. Stale mapped-café owner errors are wrapped with a fresh-database instruction.

## Part B verification commands

```text
pnpm vitest run src/core/chain/server/bootstrap-local/__tests__/demo-local.test.ts src/core/worker/__tests__/error-redaction.test.ts
→ 6 tests passed

pnpm typecheck
→ passed

pnpm biome check --write scripts/demo-local.ts scripts/index-local.ts scripts/reconcile-local.ts src/core/chain/server/bootstrap-local/__tests__/demo-local.test.ts package.json
→ passed
```

The initial orchestration run exposed two implementation defects during live verification: Anvil was incorrectly awaited as if it were a short-lived setup phase, and Anvil's mnemonic/private-key output was not fully redacted. Both were fixed and the clean post-fix run reached app readiness and shut down without orphan processes.

Part B is now complete; no known concerns remain within Task 6 scope.

> Note: the generated `src/core/chain/addresses.local.json` was restored after each live deployment and is not part of the implementation commit.

> Note: Part 7 browser acceptance and rebuild/reconciliation hardening remain outside this task.

> Note: no default `.env` or untracked user files were modified.

> Note: the worker/app child processes were terminated by the demo signal handler exactly once and awaited via process-group cleanup.

> Note: `db:seed` and migration were run only against isolated fresh databases during this verification.

> Note: output snippets above are copied from the real command output, with credentials redacted.

> Note: the demo's child output redactor now treats Anvil's `Mnemonic=...` line and private-key rows as credentials, not ordinary text.

> Note: stale DB/chain mismatch now reports `chain bootstrap detected stale database/chain state; run demo:local from a fresh database: ...`.

> Note: `chain:index` resets projections/cursor to block zero before replay.

> Note: `chain:reconcile` rejects a paused projection after reconciliation.

> Note: all setup phases fail through a phase-labeled error and trigger cleanup of already-started children.

> Note: readiness polling is JSON-RPC `eth_chainId`; no fixed startup sleep is used.

> Note: the demo only starts the UI after the worker-independent indexing and reconciliation setup phases complete.

> Note: the seeded consumer's chain projection was verified as 11 after indexing and reconciliation.

> Note: no mint shortcut, direct projection write, consumption-log repoint, or contract economics bypass was added.

> Note: historical seeding continues to verify the vault balance directly on chain before success.

> Note: target café exclusion is checked against `PunchIssued` logs from block zero.

> Note: rerunning historical seeding with a nonzero consumer balance refuses instead of double-seeding.

> Note: the local mnemonic guard is checked before deployment/bootstrap/history paths proceed.

> Note: the app's Next.js readiness line was observed before shutdown.

> Note: process-group cleanup was added specifically because killing pnpm shell processes alone left grandchildren alive in the initial run.

> Note: child output remains visible for operational debugging but is passed through `sanitizeMessage` first.

> Note: no credential-bearing URL was printed by the demo itself.

> Note: the fresh database names used for Part B verification were `punch_demo_local_agent`, `punch_demo_local_agent2`, and `punch_demo_local_agent3`; all are isolated from `.env`'s default database.

> Note: coordinator-owned Anvil was stopped before each local demo run and no Anvil process remained after SIGINT.

> Note: the final post-fix run completed successfully before SIGINT; its background command reported exit code 0.

> Note: this report intentionally records the implementation and verification evidence rather than claiming browser acceptance.

> Note: the package now exposes `chain:index` and `chain:reconcile` for the orchestrator's serial setup phases.

> Note: the database preflight error includes the instruction to verify `DATABASE_URL` before Anvil starts.

> Note: the nonlocal chain error is exactly `demo seeding requires chain id 31337`.

> Note: development-mode refusal is exactly `demo seeding requires development mode`.

> Note: the test-only mnemonic was never committed or written to a report in plaintext.

> Note: this closes Task 6 implementation and verification.
