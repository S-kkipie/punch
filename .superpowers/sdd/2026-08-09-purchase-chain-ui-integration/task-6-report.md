# Task 6 report

## Status

BLOCKED

## Implemented before block

- Added and ran TDD coverage for the local-chain guard and deterministic historical schedule in `src/core/chain/server/bootstrap-local/__tests__/historical-consumptions.test.ts`.
- Added `assertLocalChain31337` and a deterministic schedule helper in `src/core/chain/server/bootstrap-local/historical-consumptions.ts`.
- Extracted worker error redaction to `src/core/worker/error-redaction.ts`; added tests and kept the existing worker suite green.
- Added operator wallet address collection to the bootstrap repository and idempotent authorization/verification seams to bootstrap service.
- Added a serial child-process demo runner in `scripts/demo-local.ts` and package entries for `demo:local` and `chain:seed-history`.
- Added a phase-ordering test for the demo runner.

## Verification

Passing:

- `pnpm vitest run src/core/chain/server/bootstrap-local/__tests__ src/core/worker/__tests__/worker.test.ts` — 19 tests passed.
- `pnpm vitest run src/core/worker/__tests__/error-redaction.test.ts` — 2 tests passed.
- `pnpm typecheck`
- `pnpm biome check scripts/demo-local.ts scripts/bootstrap-local.ts src/core/chain/server/bootstrap-local package.json`

## Exact block

The honest historical seeding path required by the brief is not complete. `seedHistoricalConsumptions` has not been implemented, `scripts/bootstrap-local.ts --seed-history` still executes ordinary café bootstrap, and the demo runner does not yet perform real database reachability checking, Anvil `eth_chainId` polling, block-zero indexing, reconciliation, or final on-chain balance verification. I did not substitute a mint shortcut, direct projection write, or contract bypass.

Therefore I did not claim the eleven real historical PUNCH demo state, did not run `pnpm demo:local`, and the correct status is BLOCKED.
