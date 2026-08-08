# Blocker E implementation report

## Result

Implemented an explicit local DB/chain bootstrap flow. `db:seed` remains DB-only and `chain:deploy` now deploys contracts and writes the local address map without seeding a demo café. The new `chain:bootstrap-local` command reads approved seeded cafés from Postgres, links them to the live contracts, verifies chain state, and persists mappings only after successful verification.

## Implementation

- Added `src/core/chain/server/bootstrap-local/service.ts`.
  - Processes approved cafés in slug order.
  - Requires wallet index/address and validates the derived custodial owner against the DB owner.
  - Selects only emission products, ordered by `createdAt`, then `id`; assigns deterministic chain IDs starting at 1 per café.
  - Handles existing mappings as verification-only.
  - Recovers null DB mappings by scanning live café owners.
  - Seeds missing cafés with 100-credit plans through the existing `seedCafe` helper.
  - Fails closed on stale non-null mappings and does not persist before all live verification succeeds.
- Added `src/core/chain/server/bootstrap-local/repository.ts` for approved café/product reads and transactional mapping persistence.
- Added `scripts/bootstrap-local.ts` as the explicit CLI wrapper using live `addresses.local.json` and live Anvil reads.
- Extended `scripts/dev-chain.ts` so `seedCafe` accepts multiple eligible product IDs while preserving the existing single-product helper behavior; removed unconditional CLI café seeding.
- Added `chain:bootstrap-local` to `package.json`.
- Added focused unit coverage for four-café seeding, idempotent reruns, owner-based recovery, stale mappings, seed failures, and verification failures.

## TDD record

The new focused test suite was run before production implementation and correctly failed with a missing `../service` module. After implementation, it passed.

## Verification

- Focused bootstrap tests: PASS, 6 tests.
- Vitest suite included by the focused invocation: PASS, 154 tests across 20 files.
- Typecheck (`pnpm typecheck`): PASS.
- Targeted Biome check: PASS.
- `git diff --check`: PASS.
- Solidity contract suite (`pnpm contracts:test`): PASS.
- Contract build: PASS.

## Gated integration

The full Postgres + Anvil integration was not run because the environment does not provide `pg_isready` or a running local Postgres service. Anvil and Foundry are installed, and the Solidity suite/build completed successfully. No database changes were made.

## Security and scope

No mnemonic or private key is printed or included in errors. Errors retain action/status/transaction context from the existing chain helper without secrets. No unrelated user files were modified.
