# Task 7 report: Consumer + café UI

## Implementation

- Removed the consumer redemption page's local-chain refusal. In local mode, a consumer with a known eligible chain-backed PUNCH balance can now submit the redemption request.
- Extended the café redemption inbox UI for the on-chain lifecycle:
  - `confirmed` renders the fixed host payout `S/3.60`.
  - `failed` renders the sanitized `failureReason`.
  - `approved` renders `Procesando on-chain`.
- Updated the café redemption listing projection to return all redemption request statuses so confirmed and permanently failed rows remain visible. The existing `useCafeRedemptionInbox` query already refetched every 5 seconds, so no new polling mechanism was added.
- Added `getCafePayoutsService` and `GET /consumption/:cafeId/payouts`. The service gates access with `requireCafeRole(userId, cafeId, ["owner", "barista"])`, returns zero totals when the payout projection row is absent, resolves the café owner wallet, and reads `mockPEN.balanceOf(ownerWallet)` from the chain. RPC/read failures degrade `ownerMpenCentimos` to `null`.
- Added a payout summary card to the located café panel page, `src/app/(app)/(workspace)/cafe/[cafeId]/page.tsx`, showing total confirmed payout, confirmed redemption count, and owner mPEN balance or `—`.

## Design choices

- The payout endpoint follows the existing consumption Elysia router and uses a café-scoped `/:cafeId/payouts` route, matching the existing `/:cafeId/redemption-inbox` registration pattern.
- The payout card lives on the main café panel immediately below the onboarding notice and above the profile card, so owners/baristas see settlement information without navigating away.
- The existing inbox refetch interval is 5 seconds, which already satisfies the approved/confirmed transition polling requirement; adding a second interval would have duplicated requests.
- mPEN base units are converted with integer division by `10_000n` because 10,000 contract units equal one centimo. Any fractional centimo remainder is deliberately truncated, not rounded. The UI formats the resulting centimo value as a two-decimal mPEN amount.
- No wallet addresses, transaction signatures, private material, or credentials are exposed in the client response or rendered UI.

## TDD evidence

### RED

Command:

```text
pnpm vitest run 'src/app/(app)/(consumer)/redeem/[productId]/__tests__/redeem-page.test.tsx' 'src/app/(app)/(workspace)/cafe/[cafeId]/redemptions/__tests__/redemptions-page.test.tsx' src/core/consumption/server/services/__tests__/get-cafe-payouts-service.test.ts
```

Expected failures before implementation:

- The rewritten local-mode test failed with `expected true to be false` because the page still disabled the button behind `isLocalChain`.
- The new redemptions lifecycle test failed because `S/3.60` was not rendered.
- The new service test initially failed to resolve `../get-cafe-payouts-service` because the service had not been created yet.

### GREEN

Command:

```text
pnpm vitest run 'src/app/(app)/(consumer)/redeem/[productId]/__tests__/redeem-page.test.tsx' 'src/app/(app)/(workspace)/cafe/[cafeId]/redemptions/__tests__/redemptions-page.test.tsx' src/core/consumption/server/services/__tests__/get-cafe-payouts-service.test.ts
```

Result: 3 test files passed, 12 tests passed.

## Verification

- `pnpm vitest run`: 91 files passed, 536 tests passed; 13 files / 50 tests skipped by the repository's integration gating.
- `pnpm typecheck`: passed.
- Biome on all touched files: passed after formatting and import cleanup.
- `git diff --check`: passed.

The full Vitest run retains unrelated pre-existing stderr diagnostics from existing tests (Elysia exact-mirror warning in the router test and a select/div warning in the terminal test); no Task 7 test failed.

## Files changed

- `src/app/(app)/(consumer)/redeem/[productId]/page.tsx`
- `src/app/(app)/(consumer)/redeem/[productId]/__tests__/redeem-page.test.tsx`
- `src/app/(app)/(workspace)/cafe/[cafeId]/page.tsx`
- `src/app/(app)/(workspace)/cafe/[cafeId]/redemptions/page.tsx`
- `src/app/(app)/(workspace)/cafe/[cafeId]/redemptions/__tests__/redemptions-page.test.tsx`
- `src/core/consumption/client/hooks.ts`
- `src/core/consumption/domain/schemas.ts`
- `src/core/consumption/server/api/router.ts`
- `src/core/consumption/server/api/routes/get-cafe-payouts.route.ts`
- `src/core/consumption/server/repository/redemption-requests.ts`
- `src/core/consumption/server/repository/utils.ts`
- `src/core/consumption/server/services/get-cafe-payouts-service.ts`
- `src/core/consumption/server/services/__tests__/get-cafe-payouts-service.test.ts`
- This report: `.superpowers/sdd/2026-08-09-punch-redemption-onchain/task-7-report.md`

`src/core/chain/addresses.local.json` was already modified in the working tree and was not staged or changed by this task.

## Self-review findings

- Local-mode consumers now reach the same request mutation as mock-mode consumers when balance is known and eligible; the old explanatory block is removed rather than left alongside the new behavior.
- Confirmed and failed redemption requests are now returned by the café inbox query, and the UI renders fixed payout / sanitized failure reason. Approved requests show a processing state and are picked up by the existing 5-second refetch.
- The payout panel remains renderable if the chain read throws because the service catches only the owner balance read and returns `null`; the page never blocks on that value.
- The local-mode test explicitly sets `chainMode.value = "local"`; it does not rely on Vitest's test-mode default.
- No unrelated refactor or chain process was introduced. No Anvil node or dev server was started.

## Issues or concerns

- Existing repository test stderr warnings remain as noted above; they are outside Task 7 and do not affect exit status.
