# Task 3 report

## What I implemented

- Added PunchVault revert decoding for `InsufficientPunch`, `HostNotOperational`, `ProductNotEligibleReward`, and `NotRedeemer`.
- Added `punch_redemption` relayer dispatch with payload validation and `PunchVault.redeem(userWallet, BigInt(chainCafeId), BigInt(chainProductId))`.
- Added the database redemption-ledger guard before every new redemption send path. The default implementation checks `consumer_transaction.idempotency_key = chain_redemption:<requestId>`.
- Added redemption receipt replay simulation, permanent/transient revert handling, loud `NotRedeemer` logging, and submitted-job recovery without resending before ledger/receipt checks.
- Branched purchase repository relayer state transitions by job kind. Redemption jobs no longer require `orderId`; confirmation only confirms the relayer job, while permanent failure propagates `redemption_request` to `failed` only when it is still `approved`.
- Made the existing `markJobConfirmed` idempotent fallback kind-aware for redemption jobs.

## TDD evidence

### RED

Command:

`pnpm vitest run src/core/chain/server/relayer/__tests__/parse-revert.test.ts src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts`

Result: expected failure, 9 failed / 10 passed. The parse tests failed because the new PunchVault errors were not decoded, and redemption tests failed because there was no redemption dispatch or ledger guard.

### GREEN

Command:

`pnpm vitest run src/core/chain/server/relayer/__tests__/parse-revert.test.ts src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts src/core/chain/server/relayer/__tests__/relayer.test.ts`

Result: 3 files passed, 40 tests passed.

After adding the receipt replay regression:

`pnpm vitest run src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts`

Result: 1 file passed, 6 tests passed.

## Anti-double-burn revert proof

Temporarily removed the guard in `src/core/chain/server/relayer/relayer.ts` at the `submitRedemptionJob` ledger check:

`if (await hasRedemptionLedger(deps, job.redemptionRequestId)) { ... }`

Then ran:

`pnpm vitest run src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts`

Result: 1 failed / 4 passed. The test `skips send and confirms when redemption ledger already exists` observed one `wallet.writeContract` call and no confirmation, proving the test fails without the guard. The guard was restored and the focused suite passed.

## Verification

- `pnpm vitest run`: 90 files passed, 528 tests passed; 11 integration/live files skipped by the repository configuration.
- `pnpm typecheck`: passed.
- `pnpm biome check` on all touched files: passed.
- Focused relayer/parse suite: 40 tests passed before the final replay test was added; final redemption suite: 6 tests passed.

The full suite emitted pre-existing stderr from reconciler tests, an exact-mirror warning in an existing consumption API test, and an existing invalid `<select>` child warning; no test failed.

## Files changed

- `/home/skkippie/work/AI-DO/punch/src/core/chain/server/relayer/parse-revert.ts`
- `/home/skkippie/work/AI-DO/punch/src/core/chain/server/relayer/relayer.ts`
- `/home/skkippie/work/AI-DO/punch/src/core/chain/server/relayer/__tests__/parse-revert.test.ts`
- `/home/skkippie/work/AI-DO/punch/src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts`
- `/home/skkippie/work/AI-DO/punch/src/core/purchase/server/repository/purchase-repository.ts`

`src/core/chain/addresses.local.json` was already modified and was not staged or changed by this task.

## Self-review

Audited all redemption paths that can reach `writeContract`:

1. `runRelayerOnce` -> `submitJob` -> `submitRedemptionJob`: validates request id, checks the redemption ledger, then parses and sends.
2. `recoverStuckJobs`: never calls `writeContract`; it checks the redemption ledger before receipt handling, confirms successful existing receipts, replays reverted receipts, and marks missing receipts pending. A later pending retry returns through path 1 and its ledger guard.
3. A crash after chain send but before `markJobSubmitted` leaves a pending job; path 1 checks the ledger before any resend.
4. A transient failure requeues through `markJobRetry`; path 1 checks the ledger before retry send.

Consumption behavior remains structurally unchanged apart from the simulation dependency type widening and kind-aware repository returns.

## Issues or concerns

- `RelayerDeps.hasRedemptionLedger` is optional at the type boundary to preserve compatibility with existing integration-test dependency fixtures; production `defaultDeps` always supplies the database-backed implementation. If a redemption caller omits the guard, the relayer throws before `writeContract` rather than sending unsafely.
- No live chain was started, per the task instructions; live-chain verification belongs to Task 6.
