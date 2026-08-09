# Task 7 Report

## Implemented

- Added `clearChainDerivedPurchaseProjections` in `src/core/chain/server/reconciler/purchase-projection-rebuild.ts`.
- Rebuild clearing now removes chain provenance, emission history, chain balances/credits/consumption, and resets the indexer cursor; confirmed linked orders/quotes are moved back to submitted for replay.
- Campaign/crawl unlocks are reversed from recorded chain effects while campaign/crawl definitions remain intact.
- Wired the rebuild into the reconciler drift path before forced reindex.
- Added a real PostgreSQL integration test covering chain projection/effect clearing, preservation of unrelated manual voucher state and definitions, and replay idempotency.
- Updated the reconciler integration fake database adapter for the new transactional delete/update calls.

## Commands and outcomes

- `PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts` — RED: initial module-not-found failure before implementation.
- Fresh database creation with `punch_task7` — PASS.
- `DATABASE_URL=<fresh>/punch_task7 DATABASE_SSL=false pnpm db:migrate` — PASS.
- Fresh database test run after implementation — GREEN: rebuild integration test passed.
- `pnpm exec biome check --write src/core/chain/server/reconciler/purchase-projection-rebuild.ts src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts src/core/chain/server/reconciler/reconciler.ts` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm vitest run src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts src/core/chain/server/reconciler/__tests__/reconciler.test.ts` — PASS: 5 passed, 2 skipped.
- `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=<fresh>/punch_task7 DATABASE_SSL=false pnpm vitest run src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts` — PASS: 8 passed.

## Deviations and concerns

- Added `src/core/chain/server/__tests__/purchase-journey.live.test.ts`, covering seeded 11 balance, authorized quote issuance, duplicate confirmation, relayer submission, indexed confirmation to 12, campaign/crawl effects, recovery, drift injection, rebuild, idempotency, and redaction assertions.
- Clean live sequence: fresh `punch_task7_live` database, `pnpm db:migrate`, `pnpm db:seed`, fresh Anvil, `pnpm chain:deploy`, `pnpm chain:bootstrap-local`, then the gated live test.
- Final clean live Vitest output:

```text
✓ src/core/chain/server/__tests__/purchase-journey.live.test.ts (1 test) 1013ms
  ✓ live purchase journey and projection recovery > confirms once on chain, applies effects once, and rebuilds after drift 386ms

Test Files  1 passed (1)
Tests  1 passed (1)
```

- `pnpm vitest run src/core/worker/__tests__/worker.test.ts src/core/chain/server/reconciler/__tests__/reconciler.test.ts` — PASS: 7 tests.
- Initial seeded-DB relayer integration run failed during existing fixture cleanup because seeded crawl-step foreign keys reference seeded cafés; rerunning `relayer.integration.test.ts` on isolated fresh migrated `punch_task7_rel` (without demo seed) passed all 6 tests.
- `pnpm exec biome check --write src/core/chain/server/__tests__/purchase-journey.live.test.ts` — PASS.
- `pnpm typecheck` — PASS.
- Anvil was stopped after verification.
- Commits: `e1c4e9a feat(chain): rebuild purchase projections on drift`; `8f5ccbd test(chain): verify purchase projection recovery journey`.

## Reviewer fixes

- Added explicit `created_voucher_id` and `progress_id` provenance columns to `chain_purchase_effect`; generated migration `drizzle/0013_motionless_joshua_kane.sql`.
- Reversal now targets exactly the voucher/progress rows recorded by the effect, deletes only `available` vouchers, and leaves redeemed vouchers and unrelated same-campaign manual vouchers intact.
- Added three focused integration tests: load-bearing campaign/crawl reversal and replay, redeemed voucher preservation, and same-campaign manual voucher preservation.
- TDD RED evidence with both reversal functions temporarily stubbed: the load-bearing test failed because the auto voucher remained (`expected [ { … } ] to deeply equal []`); the redeemed and manual-preservation tests passed. The implementation was restored immediately afterward.
- `pnpm exec biome check --write` on all changed implementation/schema/test files — PASS.
- `pnpm typecheck` — PASS.
- Rebuild reviewer regression suite — PASS: 3 tests.
- Existing chain purchase effects integration suite — PASS: 6 tests.
- New migration applied successfully to fresh `punch_task7_fix` database.

Reviewer-fix commit: `e1960ee fix(chain): preserve voucher provenance during rebuild`.

## Expiry defect follow-up

- Added a warped-chain live journey regression: the test advances Anvil by three days before issuing and confirming the quote, while relying on the required preceding `chain:seed-history` sequence.
- RED attempt: fresh `punch_task7_expiry` database, `pnpm db:migrate`, `pnpm db:seed`, fresh Anvil, `pnpm chain:deploy`, `pnpm chain:bootstrap-local`, `pnpm chain:seed-history`, then the gated live test. The run failed before confirmation because the local bootstrap fixture could not authorize the operator (`UnprocessableEntityError`, target `operator`), so the requested `ProofExpired` live failure was not reproduced in this environment.
- Replaced wall-clock proof expiry with latest chain block timestamp plus `600n` in both `confirmQuoteService` and the legacy `confirmPurchaseService`; DB quote/order expiry authorization remains wall-clock based.
- Verified historical seeding already derives expiry from its scheduled chain timestamp (`block.timestamp + 900n`), so it was left unchanged.
- `pnpm vitest run src/core/purchase/server/services/__tests__/confirm-quote-service.test.ts src/core/purchase/server/services/__tests__/confirm-purchase-service.test.ts` — GREEN: 17 tests.
- `pnpm exec biome check --write` on all five changed code/test files — PASS.
- `pnpm typecheck` — PASS.
- Anvil stopped after verification. Addresses file and unrelated untracked files were not committed.
