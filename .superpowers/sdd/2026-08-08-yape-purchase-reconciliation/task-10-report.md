# Task 10 report

## Behavior

- Added `runReconcilerOnce(deps?)`, comparing the projected PUNCH total, café credits, and full-chain `ConsumptionRecorded` event count against chain authority.
- Reconciler now derives the authoritative café-credit membership from exact full-chain `PlanActivated` and `PackPurchased` events before reading `PlanManager.credits(cafeId)`, so chain-only and projection-only café IDs both trigger repair.
- Clean projections update `projection_status.last_good_block` and remain unpaused.
- Drift pauses the projection, wipes all three projection tables, resets the cursor to block 0, force-runs the indexer without exposing a green/unpaused state during rebuild, and rechecks.
- Successful repair clears `paused` and records the repaired cursor; unresolved divergence remains paused. Indexer/reindex failures preserve paused state.
- Added `isChainProjectionStale()` backed by `projection_status.paused`.
- Extended `runIndexerOnce` with optional `force`; forced indexing bypasses the pause guard but preserves `paused=true` and does not advance `last_good_block`.
- Forced reindex and reconciler chain reads now fetch the latest block with `cacheTime: 0`, avoiding viem block-number cache reuse during immediate post-write repair passes.

## Files

- `src/core/chain/server/reconciler/reconciler.ts`
- `src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts`
- `src/core/chain/server/indexer/indexer.ts`
- `src/core/chain/server/indexer/__tests__/indexer.test.ts`

## TDD evidence

The reconciler test harness covers clean state, deliberate balance corruption and repair, missed consumption events, chain-only café credits missing from projection, forced reindex invocation, and unresolved divergence remaining stale/paused. The gated dynamic-Anvil/Postgres live fixture covers both the required clean/corruption/missed-purchase flow and a second café activated after the indexer cursor, proving reconciliation repairs chain-only credit membership without mocks.

## Commands and results

- `pnpm test src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts` — PASS, unit coverage includes explicit `cacheTime: 0` assertions plus the chain-only café-credit regression; live tests skipped without gate.
- `pnpm test src/core/chain/server/indexer/__tests__/indexer.test.ts` — PASS.
- `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://punch:punch@127.0.0.1:5432/punch_yape_integration pnpm test src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts` — PASS, fresh dynamic Anvil/Postgres scenario repairs both deliberate projection corruption/missed purchases and a second café activated after the cursor.
- `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://punch:punch@127.0.0.1:5432/punch_yape_integration pnpm test src/core/chain/server/indexer/__tests__/indexer.integration.test.ts` — PASS, live indexer suite stays green with the uncached latest-block read.
- `pnpm typecheck` — PASS.
- `pnpm exec biome check src/core/chain/server/indexer/indexer.ts src/core/chain/server/reconciler/reconciler.ts src/core/chain/server/indexer/__tests__/indexer.test.ts src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts` — PASS.
- `git diff --check` — PASS.

## Root cause

- This was a production bug, not malformed test semantics.
- First, both `runIndexerOnce` and `runReconcilerOnce` relied on `publicClient.getBlockNumber()` with viem's default client cache. In the live missed-purchase scenario, purchase 2 and purchase 3 were mined immediately after purchase 1, but the subsequent reconciler/indexer pass reused the cached latest block from the earlier read. That capped `getLogs(... toBlock: latest)` at a stale block, so the forced full reindex replayed only the first `ConsumptionRecorded` log and repair incorrectly stayed divergent.
- Second, `readChainState()` only queried `PlanManager.credits()` for café IDs already present in `projection_cafe_credit`, and `matches()` only compared those rows. If the indexer missed the first `PlanActivated` or `PackPurchased` for a new café, reconciler could falsely report clean despite chain-only credits. The fix derives the authoritative café-ID set from exact full-chain plan events, then compares membership and values against the projection.

## Concerns

- None.
