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

## Fix round 1

### Changes

- Made `markJobConfirmed`'s not-found fallback return `null` for every terminal `punch_redemption` job before touching `purchaseOrder`; the nullable `orderId as string` cast was removed and consumption jobs now explicitly require `orderId` before the order lookup.
- Closed the broadcast/database crash window for redemptions. The relayer now encodes and signs the `PunchVault.redeem` transaction locally, computes `keccak256(signedTransaction)`, persists the job as `submitted` with the hash and signed payload, and only then calls `sendRawTransaction`.
- If broadcasting fails after persistence, the signed payload remains on the job and retries rebroadcast the same serialized transaction rather than signing a fresh transaction.
- Recovery never sends directly for either receipt-found or receipt-missing submitted redemption jobs. A missing receipt marks the job pending; the subsequent normal submission path reuses the persisted signed transaction and therefore retains the same hash. A fresh signature is never created for that job.

### Covering tests and commands

- `pnpm vitest run src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts`: 1 file passed, 7 tests passed.
- `pnpm vitest run src/core/chain/server/relayer/__tests__/parse-revert.test.ts src/core/chain/server/relayer/__tests__/relayer.test.ts src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts`: 3 files passed, 42 tests passed.
- `pnpm vitest run`: 90 files passed, 530 tests passed; 11 files skipped, 42 tests skipped.
- `pnpm typecheck`: passed.
- `pnpm biome check --write` on the three amended source/test files, followed by focused verification: passed.

The full suite retained only pre-existing stderr diagnostics from reconciler tests, exact-mirror schema handling, and an invalid `<select>` child warning; no tests failed.

### Revert-proof evidence

Temporarily reordered `sendRawTransaction` before `markJobSubmitted` in `submitRedemptionJob`, then ran:

`pnpm vitest run src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts -t "persists the signed hash before broadcasting"`

It failed with `AggregateError: relayer state update failed`; the broadcast stub threw before the persistence assertion could pass. The original order was restored, and the focused suite passed with 7 tests.

### Missing-receipt decision

I chose to persist the signed serialized transaction in `relayer_job.payload` and mark the job pending when the receipt is missing. Recovery itself does not rebroadcast, satisfying the no-send recovery invariant. On the next pending attempt, the relayer detects the persisted signed transaction, recomputes the same hash, persists the submitted state again, and rebroadcasts the identical raw transaction. Because the serialized transaction and hash are identical, this cannot create a second distinct redemption transaction; it is safe against the crash window and avoids relying on the indexer ledger arriving first.

### Fix-round files

- `/home/skkippie/work/AI-DO/punch/src/core/chain/server/relayer/relayer.ts`
- `/home/skkippie/work/AI-DO/punch/src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts`
- `/home/skkippie/work/AI-DO/punch/src/core/purchase/server/repository/purchase-repository.ts`
- `/home/skkippie/work/AI-DO/punch/.superpowers/sdd/2026-08-09-punch-redemption-onchain/task-3-report.md`

`src/core/chain/addresses.local.json` remained unstaged.
