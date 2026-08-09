# Task 5 Report: Rebuild replays redemptions

## What was implemented

- Extended `clearChainDerivedPurchaseProjections` to delete only chain-redemption ledger rows (`operation = punch_redemption` and `idempotencyKey LIKE chain_redemption:%`).
- Reset only `redemptionRequest` rows with status `confirmed` back to `approved`, allowing the replay correlation query to match them again.
- Deleted all `projection_cafe_payout` rows as chain-derived aggregate state.
- Added integration coverage for the full confirmed-redemption clear/replay round trip and for preserving failed requests and their failure reason.

## TDD evidence

### RED

Command:

```text
DATABASE_URL=<verification database URL> DATABASE_SSL=false PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts
```

Result: 1 failed, 6 passed. The new round-trip test failed at the first post-clear assertion:

```text
expected 'confirmed' to be 'approved'
Expected: "approved"
Received: "confirmed"
```

This was the expected failure because the clear function had not yet reset confirmed redemption requests (and therefore had not yet deleted the redemption ledger or payout aggregate).

### GREEN

Command:

```text
DATABASE_URL=<verification database URL> DATABASE_SSL=false PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts
```

Result: 1 test file passed, 7 tests passed.

## Revert-proof evidence

Temporarily removed only the `confirmed -> approved` update, then ran:

```text
DATABASE_URL=<verification database URL> DATABASE_SSL=false PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts -t "clear resets redemption state"
```

The focused test failed exactly as intended:

```text
expected 'confirmed' to be 'approved'
Expected: "approved"
Received: "confirmed"
```

The status reset was restored before final verification. With it restored, the focused test and complete rebuild file pass, including replay confirmation, one ledger row, and payout total/count of 360/1.

## Verification

- `pnpm exec biome check --write src/core/chain/server/reconciler/purchase-projection-rebuild.ts src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts` — passed after formatting.
- `pnpm exec biome check src/core/chain/server/reconciler/purchase-projection-rebuild.ts src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts` — passed.
- `pnpm typecheck` — passed.
- `pnpm vitest run` — passed: 90 files, 530 tests; 12 integration files/tests skipped because integration mode was not enabled.
- Gated full suite with `PUNCH_RUN_INTEGRATION=1` — the touched rebuild suite passed, but the overall run had 8 unrelated timeout failures in other integration suites under concurrent database load. No failure was in the touched files.

## Files changed

- `/home/skkippie/work/AI-DO/punch/src/core/chain/server/reconciler/purchase-projection-rebuild.ts`
- `/home/skkippie/work/AI-DO/punch/src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts`
- This report: `/home/skkippie/work/AI-DO/punch/.superpowers/sdd/2026-08-09-punch-redemption-onchain/task-5-report.md`

## Self-review

- After clear, confirmed requests are approved, redemption ledger rows are gone, payout rows are gone, and the chain punch-balance projection is gone; replay reconfirms the request and rebuilds exactly one ledger row and 360 centimos/one redemption payout aggregate.
- A second replay is protected by the existing `(operation, transactionHash, logIndex)` pre-check and the idempotency key, so it cannot double the ledger or payout.
- Failed redemption requests are not touched because the reset predicate is scoped to `confirmed`; the test verifies `failureReason` remains intact.
- The clear deletes only chain-derived redemption state and does not delete rejected or failed requests.
- Ledger deletion precedes request reset, avoiding any redemption-request foreign-key issue.
- No credentials, private keys, mnemonics, or wallet indices were added to logs, responses, or committed files.

## Issues or concerns

The gated full-suite command encountered pre-existing/concurrency-sensitive 10-second hook timeouts in unrelated integration suites. The focused gated rebuild suite passed all seven tests, and the non-gated full suite passed completely.
