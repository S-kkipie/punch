# PUNCH café domain final fix wave

## Finding 1: cross-session query-cache leak

- Cleared the TanStack Query cache after the app sign-out button completes sign-out.
- Cleared the cache in the Better Auth UI sign-out route on both success and error navigation paths.
- Updated the café panel to show its loading state while either privileged café or product query is pending or fetching, preventing stale privileged fields from rendering during revalidation.

## Finding 2: approved-café edit rules

- `updateCafeService` now keeps submitted cafés fully locked, draft/rejected cafés fully editable, and approved cafés limited to `description`, `photoUrl`, and `contactPhone`.
- Approved-café critical-field changes return a 409 conflict with the changed targets.
- The approved café panel now enables the form with only the allowlisted fields and sends only those fields to the API.
- Added service tests covering approved non-critical edits, approved critical edits, draft edits, and submitted locks.

## Finding 3: owner product CRUD

- Added Spanish per-product edit controls to `ProductList`, reusing `ProductForm` with existing product defaults.
- Added active/inactive toggle controls wired to `useUpdateProduct`.
- Rejection notes are visible in the product row and edit flow.
- Product creation is now available for approved cafés; created products still enter `pending` through the server service.
- Empty COGS values are normalized before create/update requests.

## Finding 4: client/server validation

- Tightened the café form contact phone validator to `trim().min(6).max(20)`, matching the domain schema.

## Verification

- `pnpm check:fix` — passed; no fixes pending.
- `pnpm typecheck` — passed.
- `pnpm test` — passed: 13 test files, 91 tests.

No manual browser verification was performed because no `DATABASE_URL` was available.
