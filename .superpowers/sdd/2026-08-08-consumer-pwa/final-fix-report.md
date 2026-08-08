# Consumer PWA final fix report

Status: complete

## Fixes

- Production-safe seed: `db:seed` now exits before any database reads or writes unless `NEXT_PUBLIC_DEMO_MODE === "true"`; demo password is only required in demo mode. Added isolated seed-mode decision tests.
- History provenance: confirmed history entries are auth-filtered and joined to café, product, campaign, and crawl metadata. The consumer UI renders distinct Spanish provenance for PUNCH emissions, PUNCH redemptions, and campaign/crawl vouchers, with safe null/legacy fallbacks and no wallet or chain fields.
- Scan privacy/accessibility: camera access is requested only after `Abrir cámara`/retry intent, tracks are cleaned up, QR navigation remains intact, and camera/manual controls use 44px minimum sizing. Added rendered tests for initial permission timing, intent, and target sizing.

## Verification

- `pnpm test`: 60 files, 303 tests passed
- `pnpm typecheck`: passed
- `pnpm exec biome check .`: passed
- `pnpm build`: passed
- `git diff --check`: passed

No database seed or migration command was run. `packages/contracts` was not touched.

## Concerns

- `pnpm build` reports the pre-existing workspace-root warning caused by multiple lockfiles; the build still succeeds.
