# PUNCH landing final fix wave report

Status: DONE_WITH_CONCERNS
Date: 2026-08-08
Base: 82b6819

## Fixes

- Replaced `public/landing/coffee-customer.webp` with a single-customer coffee image from Bennie Bates (`@bennieray`), sourced from Unsplash photo `ZhmrvG34IdI` under the Unsplash License. Source page: https://unsplash.com/photos/a-person-holding-a-cup-of-coffee-in-their-hand-ZhmrvG34IdI. Direct source: https://images.unsplash.com/photo-1729549929604-86a32f4a9db7. The downloaded local WebP is 1600px wide and 281,118 bytes (275 KB); visual inspection shows one person holding one coffee cup and no recognizable chain logo. Runtime path remains `/landing/coffee-customer.webp`.
- Updated `public/landing/ATTRIBUTION.md` with creator, source, license, download date, source URL, dimensions, size, and subject/logo verification.
- Refactored the final dual CTA to use a neutral section heading (`final-cta-heading`) and two `article` panes, each labelled by its own unique heading id. Café remains first in DOM and visual weight.
- Removed file-level Biome `useValidAnchor` suppression from `landing-nav.tsx`; retained only three line-level suppressions for the section hash anchors Biome flags.
- Corrected the plan copy-guardrail command to exclude `__tests__` while leaving regression tests unchanged.
- Added `src/app/icon.svg` so browser console QA has no favicon 404.
- Updated the Hallmark audit resolution note with final evidence.

## Verification

GREEN:

- `npm test` — PASS, 7 files / 54 tests.
- `npm run typecheck` — PASS.
- `npm run check` — PASS, 172 files; no Biome errors or warnings.
- `npm run build` with documented placeholder environment — PASS. Command used `DATABASE_URL=postgres://user:password@localhost:5432/punch`, `BETTER_AUTH_SECRET=change-me-min-32-chars-xxxxxxxxxxxxxxxxxx`, and `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
- `git diff --check` — PASS.
- Production-only forbidden-copy grep using the updated plan command — PASS, no output.
- Temporary PostCSS config workaround was used for Vitest/build compatibility and restored afterward.

Browser QA on the branch dev server at `http://localhost:3001/`:

- Desktop 1440x1000: hero thesis present, café CTA before consumer CTA, final panes are `ARTICLE` elements with `aria-labelledby` values `final-cta-cafe-title` and `final-cta-consumer-title`, local customer image resolves through `/landing/coffee-customer.webp`, screenshot recaptured as `punch-landing-desktop.png` through Playwright MCP.
- Mobile 375x812: menu opened with `aria-expanded="true"`; clicking `#como-funciona` moved to the target and closed the menu (`aria-expanded="false"`); both hero CTA buttons measured 52px high; `scrollWidth === clientWidth` was true (360/360); screenshot recaptured as `punch-landing-mobile.png` through Playwright MCP.
- Mobile 320x700: `scrollWidth === clientWidth` was true (305/305).
- Console after adding the icon route: 0 errors and 0 warnings.

## Files changed

- `.hallmark/audit-2026-08-07.md`
- `docs/superpowers/plans/2026-08-07-punch-landing-page.md`
- `public/landing/ATTRIBUTION.md`
- `public/landing/coffee-customer.webp`
- `src/app/icon.svg`
- `src/frontend/components/landing/__tests__/punch-landing.test.ts`
- `src/frontend/components/landing/landing-nav.tsx`
- `src/frontend/components/landing/landing.css`
- `src/frontend/components/landing/sections/dual-cta.tsx`

## Concern

Playwright MCP stores its screenshot captures in the MCP output workspace rather than exposing a filesystem path in this worktree, so the existing root screenshot artifacts could not be overwritten from this agent shell. The desktop/mobile captures were nevertheless recaptured and linked by the MCP tool output; the Hallmark audit records the clean browser values above.
