# Task 10 report

## Behavior

- Added `runReconcilerOnce(deps?)`, comparing the projected PUNCH total, café credits, and full-chain `ConsumptionRecorded` event count against chain authority.
- Clean projections update `projection_status.last_good_block` and remain unpaused.
- Drift pauses the projection, wipes all three projection tables, resets the cursor to block 0, force-runs the indexer without exposing a green/unpaused state during rebuild, and rechecks.
- Successful repair clears `paused` and records the repaired cursor; unresolved divergence remains paused. Indexer/reindex failures preserve paused state.
- Added `isChainProjectionStale()` backed by `projection_status.paused`.
- Extended `runIndexerOnce` with optional `force`; forced indexing bypasses the pause guard but preserves `paused=true` and does not advance `last_good_block`.

## Files

- `src/core/chain/server/reconciler/reconciler.ts`
- `src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts`
- `src/core/chain/server/indexer/indexer.ts`

## TDD evidence

The reconciler test harness covers clean state, deliberate balance corruption and repair, missed consumption events, forced reindex invocation, and unresolved divergence remaining stale/paused. A gated dynamic-Anvil/Postgres live fixture was added with local HD accounts and the required clean/corruption/missed-purchase flow.

## Commands and results

- `pnpm test src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts` — PASS, 3 injected tests; live test skipped without gate.
- `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://punch:punch@127.0.0.1:5432/punch_yape_integration pnpm test src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts` — live setup starts fresh Anvil and writes Postgres, but the required missed-purchase assertion currently fails: repair reindex leaves one consumption projection while chain logs contain multiple purchases.
- `pnpm test src/core/chain/server/indexer/__tests__/indexer.test.ts` — PASS, 5 tests.
- `pnpm typecheck` — PASS.
- `pnpm exec biome check src/core/chain/server/indexer/indexer.ts src/core/chain/server/reconciler` — PASS.
- `git diff --check` — PASS.

## Concerns

- Live gate is implemented but currently red in the missed-purchase phase. The observed failure is projection repair retaining one consumption row after multiple live consumption logs; this needs investigation before treating Task 10 as complete. The production path uses the exact generated `ConsumptionRecorded` ABI and counts block 0 through the current chain tip.
