# Task 14 report

## Implementation

- Added the café campaigns page at `src/app/(app)/(workspace)/cafe/[cafeId]/campaigns/page.tsx`.
- Added campaign client hooks for listing, creating, funding, and publishing. Mutations invalidate the café campaign query and do not optimistically change chain state.
- Added the four exact API routes:
  - `GET /cafe/:cafeId/campaigns`
  - `POST /cafe/:cafeId/campaigns`
  - `POST /cafe/:cafeId/campaigns/:campaignId/fund`
  - `POST /cafe/:cafeId/campaigns/:campaignId/publish`
- Mounted the campaign router in `src/server/router.ts`.
- Added a list service that authorizes the café owner, reads campaigns from the repository, and obtains lifecycle/funding/canPublish data through `getCampaignFundingService`.
- API serialization converts all bigint monetary values to decimal strings. Payout and funding request amounts are validated as positive decimal integer strings before BigInt conversion.
- The page keeps prospective form budget separate from persisted projection funding, renders creating/pending state, displays exact missing funding, disables publish while underfunded, and hides publish for creating/published/cancelled campaigns.

## Tests

- Added page tests covering prospective budget calculation, creating state, underfunded draft state, and fully funded draft state.
- Added API route tests covering authentication, invalid payout validation, exact transformed service arguments, bigint serialization, and service error mapping.

## Verification

- `pnpm typecheck` passed.
- `pnpm check --no-errors-on-unmatched` passed.
- Focused page suite passed: 4 tests.
- Campaign API route suite passed: 3 tests.
- Campaign domain/service suites passed: 26 tests.

## Limitations

- Full repository test suite and chain integration gate were not run in this isolated worktree; no shared anvil process was started or changed.
