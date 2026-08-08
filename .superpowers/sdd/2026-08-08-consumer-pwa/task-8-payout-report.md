# Task 8 payout report

## Status
Implemented fixed modeled café-host payout persistence for confirmed PUNCH redemptions.

## Changes
- Added nullable `consumer_transaction.modeled_host_payout_centimos`.
- Added strict lifecycle CHECK: confirmed PUNCH redemptions require modeled payout 360; pending/rejected/failed PUNCH redemptions require NULL; emission and voucher redemptions require NULL. `coalesce(..., false)` prevents SQL NULL from bypassing the confirmed requirement.
- Added migration backfill for existing confirmed PUNCH redemptions before the CHECK is installed.
- Extended `updateTransactionStatus` with a backward-compatible options argument and non-negative integer validation.
- Mock chain now performs the exact 12-PUNCH burn and atomically updates status to confirmed with modeled payout 360. Insufficient balance rejects with payout NULL; repeat polling does not rewrite.
- Added schema/generated SQL and mock-chain assertions.

## Verification
- `pnpm db:generate` twice: stable on second run.
- `pnpm vitest run`: 30 files, 220 tests passed.
- Targeted schema, mock-chain, and repository safety tests: 42 tests passed.
- `pnpm typecheck`: passed.
- Task 8 touched-file Biome check: passed.
- Full `pnpm check` remains blocked by pre-existing formatting/lint issues outside Task 8, including `src/core/consumption/server/api/routes/request-punch-redemption.route.ts` and generated snapshot formatting.

## Concerns
No Task 8 functional concerns identified. Full repository formatting should be addressed separately to avoid unrelated changes.
