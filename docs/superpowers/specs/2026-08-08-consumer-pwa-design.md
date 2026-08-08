# PUNCH Consumer PWA Design

**Date:** 2026-08-08  
**Status:** Approved design  
**Parent specification:** `docs/superpowers/specs/2026-08-07-punch-master-spec.md`

## 1. Purpose

Build the consumer-facing PUNCH PWA as a complete two-role MVP demonstration. A barista generates a short-lived purchase proof, a consumer confirms it without seeing a wallet, PUNCH progress updates after confirmation, eligible purchases advance campaigns and a coffee crawl, and a café validates a later redemption.

This slice uses PostgreSQL-backed mock chain behavior behind a service port while `ConsumptionLog` and `PunchVault` are being built in parallel. The UI and application services must not depend on mock storage or viem directly, so the mock can later be replaced by a relayer, contracts, and indexer.

## 2. Product principles and invariants

The implementation must preserve these parent-spec rules:

- One valid paid purchase emits exactly one PUNCH.
- Every redemption burns exactly 12 PUNCH.
- PUNCH is non-transferable, non-withdrawable, non-monetary, and does not expire in the MVP.
- The UI never displays a monetary value per PUNCH.
- The UI never accepts a free-form PUNCH quantity and never offers user-to-user transfer.
- A campaign voucher is visually and semantically separate from PUNCH and never changes the PUNCH balance.
- Reward products retain the existing retail cap of S/12 and fixed modeled payout of S/3.60.
- A confirmed redemption atomically burns 12 PUNCH and records the modeled host payout; a rejected redemption changes neither.
- Chain state is the future authority. PostgreSQL is a projection except when the explicitly selected demo adapter is active.
- Consumers never need to know about Arbitrum, addresses, gas, seeds, or custodial wallets.

The PUNCH balance is an integer. The home meter displays `min(balance, 12) / 12`; when balance is at least 12 it displays `12 / 12` and “Recompensa disponible.” Each redemption always subtracts exactly 12. The UI may also show the integer PUNCH count, but never a fiat conversion.

## 3. Decisions

The approved choices are:

- Campaigns, vouchers, and coffee crawls are functional PostgreSQL-backed mock flows, not static shells.
- The café panel receives a minimal QR generator and redemption inbox so the demo is end to end.
- Mock state persists in PostgreSQL across server restarts.
- Mobile navigation uses action-centered bottom tabs.
- Geolocation is progressive: discovery works by district before location permission is requested.
- Scanning uses the browser camera when supported, with deep-link and pasted-code fallbacks.
- Consumer signature requires explicit confirmation but exposes no wallet concepts.
- Café validation uses a minimal barista inbox.
- The PWA is installable and offers resilient offline reads, but never queues offline mutations.
- Visual language reuses the landing page exactly and adapts it into an editorial mobile product.
- The primary acceptance journey is a guided two-role demo lasting three to five minutes.

## 4. Information architecture

The public landing page remains at `/`. After consumer authentication, the app redirects to `/home` rather than the starter route `/projects`.

### 4.1 Consumer navigation

A fixed mobile bottom navigation contains:

1. **Inicio** — progress, scan CTA, nearby cafés, and active campaign/crawl summaries.
2. **Descubre** — approved cafés and eligible products.
3. **Escanear** — visually central purchase action.
4. **Historial** — emissions, redemptions, and vouchers.
5. **Más** — campaigns, routes, profile, and PWA installation help.

Desktop uses the same information architecture in a wider navigation treatment. It does not become a separate product.

### 4.2 Consumer routes

- `/home`
- `/discover`
- `/discover/[cafeId]`
- `/scan`
- `/purchase/[proofId]`
- `/history`
- `/redeem/[productId]`
- `/campaigns`
- `/campaigns/[campaignId]`
- `/crawls`
- `/crawls/[crawlId]`

### 4.3 Minimal café routes

- `/cafe/[cafeId]/terminal` — choose an approved emission product and generate a signed, short-lived QR/deep link.
- `/cafe/[cafeId]/redemptions` — approve or reject pending PUNCH or voucher fulfillment requests with an actionable reason.

These routes extend the existing café panel without changing café onboarding, catalog ownership, or review behavior.

## 5. Experience design

### 5.1 Visual system

The consumer product reuses the landing page’s current design tokens, typography, radii, shadows, textures, icon style, and Spanish voice. Layout becomes denser and touch-oriented while remaining editorial and neighborhood-focused. It must not adopt a blue fintech dashboard or crypto-wallet aesthetic.

PUNCH progress uses the primary product treatment. Campaign vouchers use a distinct ticket-like shape, label, and accent so they cannot be confused with PUNCH. Emission products and reward products also receive distinct labels and calls to action.

### 5.2 Home

Home presents:

- a greeting and contextual neighborhood line;
- the `n / 12` progress meter and fixed-reward explanation;
- the primary “Escanear compra” action;
- a nearby-café preview;
- one active campaign or available voucher;
- active coffee-crawl progress;
- recent confirmed activity.

Home must remain useful with empty, loading, saved-offline, retryable, and populated states.

### 5.3 Discovery

Discovery reuses existing approved café and approved-product APIs. It initially shows all seeded cafés grouped or filtered by district. “Cerca de mí” requests browser location only after the consumer taps it. Acceptance sorts cafés with coordinates by distance; denial or unsupported geolocation leaves district discovery fully usable.

Café detail separates:

- products that emit one PUNCH after a valid paid purchase;
- reward products redeemable for a fixed 12 PUNCH;
- campaign vouchers accepted by that café, when applicable.

### 5.4 Scan and purchase confirmation

The scan route uses `BarcodeDetector` when supported. A QR deep link can also open `/purchase/[proofId]`, and the route provides a pasted-code fallback for desktop and CI.

The confirmation sheet shows café, product, Yape amount, and expiry. Its explicit “Confirmar compra” action authorizes the custodial signature through the server. It does not show an address, network, gas, seed, or signature bytes.

### 5.5 History

History combines three visually distinct event classes:

- PUNCH emissions;
- PUNCH redemptions;
- voucher unlocks and uses.

Filters do not change ledger semantics. Every item shows café, product or campaign, timestamp, status, and actionable failure information when relevant.

### 5.6 Campaigns and coffee crawls

The MVP seeds:

- one verified-acquisition campaign where a consumer with no prior paid purchase at the target café unlocks a one-use return voucher after a valid purchase in the campaign window;
- one A→B→C coffee crawl where three distinct confirmed purchases at the required cafés before expiry unlock a collective one-use voucher.

Campaign and crawl vouchers have `available`, `redeemed`, and `expired` lifecycle states. “Usar voucher” creates a café fulfillment request. Barista approval marks it redeemed exactly once without changing PUNCH. Rejection leaves the voucher available unless it has expired.

## 6. Architecture

### 6.1 Domain boundaries

`src/core/consumption` owns:

- purchase-proof schemas and EIP-712 payloads;
- café and consumer authorization signatures;
- purchase submission and transaction lifecycle;
- PUNCH and voucher fulfillment requests;
- emissions/redemptions history;
- barista authorization for operational actions.

`src/core/punch` owns:

- balance projection and `n / 12` progress;
- campaign eligibility and voucher lifecycle;
- coffee-crawl definitions, ordered steps, and consumer progress;
- the aggregated consumer dashboard read model.

Both domains follow the established `domain`, `server`, and `client` organization used by `src/core/cafe`. Public types and schemas must make each boundary understandable without reading its implementation.

### 6.2 On-chain port

Application services depend on a `ConsumerChainPort` with these capabilities:

- `submitConsumption(proof)`
- `submitPunchRedemption(approvedRequest)`
- `submitVoucherRedemption(approvedRequest)`
- `getTransactionStatus(transactionId)`
- `getPunchBalance(userId)`

`PostgresMockConsumerChain` is selected in demo mode. It returns synthetic transaction identifiers, models pending-to-terminal transitions, and updates projections transactionally. It must enforce the same authorization, expiry, replay, idempotency, and fixed-quantity rules expected from the real adapter.

A future `ViemConsumerChain` will call a relayer and read indexed `ConsumptionLog`, `PunchVault`, and campaign state. Replacing the adapter must not require changes to application services, React hooks, or components.

The selected adapter supplies the EIP-712 domain context. Demo mode uses an explicitly named deterministic mock verifier address and Arbitrum Sepolia chain ID `421614`; production integration must supply the deployed verifying contract address. Services never invent or hard-code a production address.

### 6.3 PostgreSQL projections

Required persisted records are:

- `consumption_proof` — payload, café signature, consumer signature, unique nonce, receipt hash, expiry, and status;
- `consumer_transaction` — emission/redemption/voucher operation, synthetic or real transaction ID, lifecycle status, rejection reason, and timestamps;
- `punch_balance_projection` — integer balance by consumer;
- `redemption_request` — fixed PUNCH reward or voucher request, café, consumer, product/voucher, and state;
- `campaign` and `consumer_voucher`;
- `coffee_crawl`, `coffee_crawl_step`, and `consumer_crawl_progress`.

The mock adapter is the only code allowed to treat these records as command authority. Read services treat them as projections. Names, comments, and module boundaries must make that temporary role explicit.

Necessary integration files outside the new domains are limited to Drizzle schema exports/migrations, router registration, authenticated navigation, and the existing café panel links.

## 7. Core flows

### 7.1 Purchase

1. An authorized owner or barista selects an approved, active emission product.
2. The service revalidates café/product state and calls existing lazy wallet assignment for the barista user.
3. It builds an EIP-712 payload containing `cafeId`, `user`, `productId`, `amount`, `receiptHash`, `nonce`, `expiry`, `chainId`, and `verifyingContract`.
4. The café-side custodial account signs the short-lived proof.
5. The panel renders a QR and equivalent deep link/code.
6. The authenticated consumer opens the proof and reviews café, product, amount, and expiry.
7. “Confirmar compra” invokes lazy wallet assignment and adds the consumer authorization signature.
8. The service submits through `ConsumerChainPort` and receives a pending transaction.
9. Polling with backoff reaches a terminal state.
10. Confirmation increments the consumer balance exactly once, writes history, evaluates campaign eligibility, and advances a matching crawl step idempotently.

### 7.2 PUNCH redemption

1. A consumer with balance at least 12 chooses an approved, active reward product.
2. The UI confirms the fixed cost of 12 PUNCH; no quantity field exists.
3. The service creates a pending café request.
4. An authorized café member approves or rejects it.
5. Rejection stores an actionable reason and preserves the full balance.
6. Approval submits through the port.
7. Mock confirmation transactionally subtracts exactly 12, records the modeled payout, and marks the request confirmed.
8. The consumer sees updated progress and history.

### 7.3 Voucher fulfillment

1. A confirmed qualifying purchase unlocks a voucher exactly once.
2. The consumer selects “Usar voucher” at an eligible café.
3. The café receives a request visually distinct from a PUNCH redemption.
4. Approval marks the voucher redeemed exactly once; rejection leaves it available until expiry.
5. No voucher operation changes the PUNCH balance.

## 8. Transaction states and error handling

Every chain-touching or mock-chain action uses the same visible lifecycle:

1. **Cargando**
2. **Esperando firma** — accompanied by “Confirma para autorizar,” without wallet terminology
3. **Pendiente on-chain**
4. **Confirmado**
5. **Reintento disponible**
6. **Rechazado** — always with an actionable reason

A shared transaction-status component shows the current state, elapsed context, and next action. Polling uses bounded backoff. Reopening a route recovers state by transaction ID. Duplicate taps reuse an idempotency key and cannot duplicate an emission, burn, or voucher use.

Required error behavior:

- Expired QR: “Pide al barista uno nuevo.”
- Invalid or ineligible product: “Este producto no puede emitir PUNCH.”
- Reused proof: return and display the original result.
- Offline: retain current screen and disable mutation; never queue a signature or transaction.
- Insufficient balance: show remaining progress and disable redemption.
- Café rejection: show its reason and confirm that PUNCH or voucher remains intact.
- Retryable transaction: retry status/submission for the same operation, not a new operation.
- Expired session: return to login and then restore the intended route.

## 9. Security and privacy

- Authentication is required for every consumer or café mutation.
- Existing café-role guards protect QR generation and fulfillment approval.
- Nonces and receipt hashes are unique at the database level.
- The server, not the client clock, validates proof expiry.
- Café membership, café approval, product approval, product activity, and economic limits are revalidated at confirmation time.
- Existing lazy wallet assignment runs before any custodial account derivation.
- Mnemonics, private keys, full signatures, and secrets never reach client components or logs.
- Logs use record IDs and truncated transaction identifiers.
- Mock mode enforces replay and authorization rules rather than bypassing them.
- Cached private reads are scoped to the signed-in user and removed on logout.

## 10. PWA and offline behavior

The product includes:

- a web app manifest, landing-aligned icons, theme color, and `display: standalone`;
- a registered service worker;
- cached application shell and static assets;
- safe cached reads for the latest dashboard and history snapshot, marked “Datos guardados” when offline;
- explicit online checks before purchase, redemption, voucher use, and café approval;
- no offline mutation queue;
- camera permission only after user intent;
- deep-link and pasted-code scan fallbacks.

Touch targets are at least 44 px. Core text and controls meet WCAG AA contrast. Reduced-motion preferences disable nonessential movement. Transaction updates use an ARIA live region, and all camera actions have non-camera equivalents.

## 11. Testing strategy

Implementation follows test-driven development.

### 11.1 Domain tests

- EIP-712 payload, nonce, receipt, and expiry validation;
- legal transaction and fulfillment transitions;
- integer balance and `min(balance, 12) / 12` progress;
- fixed 12-PUNCH redemption requirement;
- voucher/PUNCH separation;
- first-purchase campaign eligibility and idempotency;
- ordered A→B→C crawl with distinct purchases and expiry.

### 11.2 Service and adapter tests

- only authorized café members can generate proofs or decide fulfillment;
- expired, altered, or repeated proofs fail safely;
- repeated consumer confirmation emits once;
- repeated café approval burns or redeems once;
- rejection preserves balance/voucher state;
- pending transactions reach confirmed, retryable, or rejected states;
- campaign and crawl unlocks happen once;
- `PostgresMockConsumerChain` satisfies the shared port contract.

### 11.3 UI tests

- home renders all progress states;
- emission, reward, PUNCH, and voucher treatments remain distinct;
- all six transaction states render actionable Spanish copy;
- camera fallback works without `BarcodeDetector`;
- offline mode exposes saved reads and blocks mutations;
- navigation, empty/error states, and semantic accessibility remain intact.

### 11.4 Required verification

- `pnpm test`
- `pnpm typecheck`
- `pnpm biome check src`
- `pnpm build`
- manual mobile and desktop run-through of the two-role demo

## 12. Deterministic demo state

The demo seed is repeatable and starts the seeded consumer with:

- 11 PUNCH;
- two confirmed steps of a three-café crawl;
- no prior paid purchase at the final target café;
- one verified-acquisition campaign targeting that same café;
- no previously used proof, reward redemption, or campaign voucher.

The next valid target-café purchase therefore increments progress to `12 / 12`, completes the crawl, and satisfies the acquisition campaign without violating `1 compra válida = 1 PUNCH`. It unlocks separate acquisition and crawl vouchers. The normal database seed command restores this canonical demo state only in development/demo mode. Ordinary server restarts preserve current projected state.

## 13. Acceptance journey

The implementation is accepted when this three-to-five-minute journey works:

1. Restore the canonical demo seed and sign in as the seeded target-café barista.
2. Generate a QR for an approved emission product.
3. Sign in as the seeded consumer and scan/open the proof.
4. Review and explicitly confirm the purchase.
5. Observe pending then confirmed state and progress increase from `11 / 12` to `12 / 12`.
6. See the acquisition campaign and coffee crawl complete and their vouchers appear separately from PUNCH.
7. Request an approved reward product for the fixed cost of 12 PUNCH.
8. Return to the café role and approve the request.
9. Observe confirmed redemption, balance reduced by 12, and complete history.
10. Use one available voucher through the distinct café-approval flow and confirm that PUNCH does not change.
11. Reload the server and retain projected demo state.
12. Go offline and view the last safe snapshot while every mutation remains disabled.

## 14. Scope

### Included

- Consumer home, discovery, scan, confirmation, history, PUNCH redemption, campaigns, vouchers, and coffee-crawl screens.
- Installable PWA and resilient offline reads.
- PostgreSQL mock adapter and on-chain service boundary.
- Minimal café QR terminal and fulfillment inbox.
- Seed data required for the guided demo.
- Integration with existing authentication, custodial wallet assignment, café catalog, café roles, and Arbitrum Sepolia chain constants.

### Excluded

- Contract implementation or modification.
- Real viem adapter, relayer, or indexer.
- Real Yape or POS integration.
- Real payout settlement.
- Campaign authoring/admin tools.
- Push notifications.
- Offline mutation queues.
- Maps, routing, or multi-city support.
- Consumer PIN or biometrics.
- Unrelated café, identity, starter-project, or operations refactors.
