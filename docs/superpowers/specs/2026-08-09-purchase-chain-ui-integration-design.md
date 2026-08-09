# PUNCH Purchase Chain UI Integration Design

**Date:** 2026-08-09
**Status:** Approved design
**Parent specifications:**

- `docs/superpowers/specs/2026-08-07-punch-master-spec.md`
- `docs/superpowers/specs/2026-08-08-consumer-pwa-design.md`
- `docs/superpowers/specs/2026-08-08-yape-purchase-reconciliation-design.md`

## 1. Purpose

Connect the existing café-terminal and consumer-PWA purchase journey to the existing local-chain purchase, relayer, indexer, and reconciler stack. A barista-issued QR becomes a short-lived café authorization, consumer confirmation creates and signs one real `ConsumptionProof`, the relayer submits it to Anvil, and only indexed chain events update the visible PUNCH balance and campaign/crawl progress.

This subproject integrates purchase emission and balance only. In real-chain mode, PUNCH reward redemption is disabled until its own chain-integration subproject because a PostgreSQL-only burn would diverge from the displayed chain balance. Voucher redemption may continue through the existing PostgreSQL mock adapter because it does not alter PUNCH. Full mock mode remains available for isolated consumer-PWA tests.

## 2. Product and economic invariants

- One valid paid purchase emits exactly one PUNCH.
- A purchase becomes economically confirmed only after `ConsumptionRecorded` and `PunchIssued` are observed from the configured chain.
- Both café and consumer authorize the exact café, consumer, product, amount, receipt hash, nonce, and expiry represented by the submitted EIP-712 proof.
- Café authorization occurs when an authenticated authorized café operator issues the QR. Because the consumer address is not known yet, the server records that authorization and produces the operator's custodial signature only after the consumer binds the quote.
- PostgreSQL stores authorization, queue state, projections, and read models. It never declares an emission solely because a client or relayer submitted it.
- Chain remains economic authority. Indexer is the only bridge from a confirmed economic event to balance, history, campaign, and crawl projections.
- A quote, purchase order, relayer job, chain event, PUNCH increment, campaign qualification, and crawl step are each idempotent.
- QR payload contains only an opaque quote identifier. It never contains a Yape reference, wallet, signature, mnemonic, private key, or chain configuration.
- The local Anvil mnemonic is test-only, must run only on chain ID `31337`, and must never receive real funds.

## 3. Scope

### Included

- Adapt the current barista QR flow into a short-lived purchase quote and café authorization.
- Bind the authenticated consumer to that quote.
- Create a real `purchase_order` and `relayer_job` without a second café interaction.
- Sign the exact existing `ConsumptionProof` using the bound consumer wallet and issuing café operator wallet.
- Submit through the existing relayer and recover through its existing retry policy.
- Confirm purchase and quote from indexed `ConsumptionRecorded` evidence.
- Read consumer balance from the chain-backed projection with staleness metadata.
- Project confirmed purchases into existing consumer history, acquisition campaigns, and coffee crawls.
- Register seeded baristas as local-chain café operators.
- Provide a deterministic local demo command and chain-backed initial state.
- Preserve existing reward and voucher redemption behavior in explicit full-mock mode.
- Preserve voucher redemption in real-chain mode while disabling PostgreSQL-only PUNCH reward burns.

### Excluded

- Arbitrum Sepolia deployment.
- Real Yape or POS API integration.
- On-chain PUNCH reward redemption.
- On-chain voucher redemption or `CampaignEscrow` runtime integration.
- Production key custody, HSM/KMS integration, or account recovery.
- Production-grade chain reorganization handling beyond the local-chain confirmation model already selected.
- Push notifications, payout settlement, and new campaign-authoring features.

## 4. Authority and module boundaries

### `src/core/consumption`

Owns the user-facing quote and fulfillment experience:

- barista quote creation;
- QR/deep link rendering;
- consumer quote review and confirmation;
- purchase status presentation;
- voucher mock fulfillment in real-chain mode;
- reward and voucher mock flows when explicit full-mock mode is selected.

`consumption_proof` becomes a compatibility-named purchase-quote record. It no longer acts as mock economic authority for emissions.

### `src/core/purchase`

Owns the real emission command:

- quote-to-order conversion;
- consumer and café operator wallet resolution;
- exact EIP-712 proof construction;
- both custodial signatures;
- purchase-order state;
- relayer-job creation;
- chain-backed balance endpoint.

A focused bridge service is the only code allowed to convert a quote into an order. UI services do not duplicate purchase proof or queue logic.

### `src/core/chain`

Continues to own:

- contract addresses and ABIs;
- relayer submission and recovery;
- event indexing;
- projection status;
- drift reconciliation and forced rebuild.

### `src/core/punch`

Continues to own campaign/crawl rules and dashboard composition. It consumes indexed purchase facts rather than mock-adapter callbacks. Economic balance comes from `projection_punch_balance`; campaign and crawl records remain PostgreSQL projections.

## 5. Quote model

The existing `consumption_proof` table remains in place to limit migration risk, but its emission fields gain quote semantics.

Required state:

- `id`: opaque QR identifier;
- `cafeId` and `productId`;
- `issuedByUserId`: authenticated café operator who authorized the quote;
- `consumerUserId`: null until consumer confirmation;
- `amountCentimos`: presentation amount derived from approved product price;
- `yapeRef`: server-only reference, 4–120 characters;
- `purchaseOrderId`: nullable unique link to `purchase_order`;
- `status`: `issued | submitted | confirmed | failed | expired`;
- `failureReason`: nullable safe code;
- `expiresAt`, `createdAt`, and `updatedAt`.

Legacy mock-emission fields (`receiptHash`, `nonce`, `cafeSignature`, and `consumerSignature`) are no longer written by the new quote path. The migration may keep them nullable for compatibility while all current application reads move to order/job data. Removal is deferred until no deployed database requires compatibility.

Database constraints:

- one quote links to at most one purchase order;
- one purchase order links to exactly one quote for UI-originated purchases;
- `yapeRef` is never returned in full after creation;
- terminal quote creation derives amount from the product and never accepts a client-controlled amount;
- status shape requires `consumerUserId` and `purchaseOrderId` for `submitted` or `confirmed`.

## 6. Café authorization and operator mapping

An authenticated user may issue a quote only when all checks pass:

1. Existing application membership is `owner` or `barista` for the café.
2. Café is approved and has `chainCafeId`.
3. Product belongs to the café, is active, approved, emission-kind, and has `chainProductId`.
4. Product price is at least S/8.00.
5. User has an assigned custodial wallet.
6. `CafeRegistry.isAuthorized(chainCafeId, walletAddress)` is true.

The quote records `issuedByUserId`. Later proof signing must use that same user's wallet index; it may not silently substitute an owner or another café member.

Local bootstrap assigns wallets to seeded café operators and registers those addresses in `CafeRegistry`. A missing or stale operator mapping causes quote creation to fail with an actionable authorization error before a QR is issued.

## 7. Purchase flow

### 7.1 Barista issues quote

The terminal submits `productId` and `yapeRef`. Server validates the operator, café, product, price, and reference, then creates an `issued` quote with a ten-minute expiry. Response contains only:

```ts
{
    id: string;
    expiresAt: string;
    deepLink: string;
}
```

The deep link is `/purchase/{quoteId}`. The client never hashes the receipt and never creates nonce or signature material.

### 7.2 Consumer reviews quote

Authenticated consumer loads the quote and sees:

- café;
- product;
- amount;
- expiry;
- a masked Yape reference.

The server returns neither the full `yapeRef` nor legacy signatures. Expired quotes become `expired` before response.

### 7.3 Consumer confirms quote

Confirmation executes one transactional bridge operation:

1. Lock quote row.
2. If it already links to an order, return that order and perform no new mutation.
3. Revalidate expiry, quote state, café, product, operator membership, operator on-chain authorization, and chain mappings.
4. Assign or load consumer custodial wallet.
5. Load the exact issuing operator wallet.
6. Create `orderId`, random full-width uint256 nonce, and expiry no later than the quote expiry and no later than ten minutes from current server time.
7. Derive `receiptHash = keccak256(toBytes(`${orderId}:${yapeRef}`))`.
8. Build the existing `ConsumptionProof` with mPEN amount, chain café/product IDs, consumer address, receipt hash, nonce, and expiry.
9. Sign that exact proof with consumer and issuing operator custodial accounts.
10. Insert `purchase_order` and its unique `relayer_job`.
11. Link quote to order, bind consumer, and mark quote `submitted`.
12. Commit all writes atomically.

The order enters `queued`. No PUNCH balance, history confirmation, campaign qualification, or crawl step changes during this transaction.

The existing buyer-first `POST /api/v1/purchases` endpoint remains available for service-level use. Consumer PWA confirmation uses the quote bridge endpoint so it preserves the approved barista-first experience.

## 8. State mapping

Quote lifecycle:

```text
issued → submitted → confirmed
   └──→ expired
submitted → failed
```

Purchase lifecycle for this path:

```text
queued → submitted → confirmed
   └──→ failed
```

Mapping rules:

- Quote `submitted` means a linked real order/job exists, not that chain confirmed it.
- Purchase `submitted` means transaction hash exists.
- Indexed matching evidence moves purchase and quote to `confirmed`.
- Permanent relayer failure moves purchase and quote to `failed` with a safe reason.
- Expiry before queue creation moves quote to `expired`.
- A submitted transaction is never marked expired solely because proof wall-clock expiry passes after mining submission; receipt recovery determines terminal state.

Client copy maps these states to the existing Spanish transaction lifecycle without exposing wallet vocabulary.

## 9. Indexed projections

`ConsumptionRecorded` remains the canonical matching evidence for a purchase. Event application occurs in the same database transaction as cursor advancement.

For a matching nonterminal purchase, event application:

1. Inserts deduplicated `projection_consumption` row.
2. Marks purchase confirmed.
3. Marks linked quote confirmed.
4. Upserts a confirmed emission `consumer_transaction` for existing history UI, keyed by quote/order identity and chain transaction hash.
5. Evaluates acquisition campaign eligibility once.
6. Advances one matching coffee-crawl step once.
7. Advances indexer cursor.

`PunchIssued` updates `projection_punch_balance`. UI may display new balance only from that projection. Event order is deterministic by block number, transaction index, and log index.

Campaign and crawl projection records store chain provenance sufficient for deterministic deduplication:

```text
purchaseOrderId
transactionHash
logIndex
```

No mock-chain emission callback may change balance, campaign, or crawl state for a quote linked to a real order.

## 10. Balance and staleness

Consumer dashboard resolves the authenticated user's custodial wallet address and reads `projection_punch_balance`. Missing balance means zero only when projection status exists and is green; missing projection status means stale.

Public dashboard balance shape is:

```ts
{
    punchBalance: number;
    stale: boolean;
}
```

Stale becomes true when:

- chain projection status row is missing;
- projection is paused;
- reconciliation has detected drift and not completed a green rebuild.

The UI retains last projected balance and displays `Actualizando desde la cadena`. It never falls back to the mock `punch_balance_projection` for emission balance.

In real-chain mode, voucher screens may continue to use existing mock fulfillment state because vouchers do not alter PUNCH. Fixed-cost PUNCH reward submission is disabled, and the UI explains that chain-backed redemption is not yet available. Full-mock mode retains the existing reward journey for isolated tests and presentations, but it must be visibly configured and may not mix its balance with chain projections.

## 11. Reconciliation and rebuild

Existing chain reconciliation continues comparing:

- projected total PUNCH against `totalLivePunch()`;
- projected café credits against authoritative values;
- projected consumption count against exact full-chain events.

On drift:

1. Pause chain-backed reads.
2. Clear chain economic projections and chain-derived purchase projection effects.
3. Reset cursor to block zero.
4. Reindex all events while paused.
5. Rebuild purchase confirmations, balances, history emissions, campaign qualifications, and crawl steps using provenance keys.
6. Recheck authoritative totals.
7. Resume only when green.

Campaign/crawl definitions and manual non-chain state remain intact. Only progress/unlocks derived from indexed purchases are rebuilt.

## 12. Failure handling

- Invalid, missing, or expired quote: return actionable conflict and request a new QR.
- Invalid café/product/operator mapping: reject before order creation.
- Full Yape reference never appears in response or logs.
- Concurrent confirmation: row lock and unique quote/order constraint ensure one order/job; all callers receive the same result.
- Invalid signature, nonce conflict, receipt replay, insufficient credits, daily limit, ticket too small, product ineligible, or expired proof: existing permanent relayer policy applies and quote mirrors safe failure code.
- Temporary RPC/submission failure: existing exponential retry policy applies.
- Submitted transaction missing after restart: existing recovery resumes by hash or retries safely.
- Indexer lag: order remains submitted and balance is stale or unchanged until event projection.
- Duplicate event delivery: provenance and event uniqueness constraints produce no duplicate balance, history, campaign, or crawl mutation.
- Offline browser: current screen remains visible, mutation is disabled, and no signature or transaction is queued client-side.
- Worker-loop error: loop logs redacted context and other worker loops continue.

## 13. Local demo environment

`pnpm demo:local` provides one coherent local-chain demo. PostgreSQL must be reachable through configured environment; the command must fail clearly rather than start against an unavailable database.

The orchestration sequence is:

1. Run migrations and deterministic database seed.
2. Start a clean Anvil chain with the configured local-only mnemonic.
3. Build and deploy contracts.
4. Bootstrap approved cafés, chain product mappings, plans, credits, and seeded café operators.
5. Generate eleven historical real consumption proofs for the seeded consumer, submit them through contract calls, and distribute them across cafés and UTC days so daily limits remain valid.
6. Run a full index from block zero and verify reconciliation green.
7. Start worker and Next.js, with signal handling that drains child processes.

The initial state remains:

- seeded consumer has exactly 11 on-chain PUNCH;
- dashboard reads `11 / 12` from chain projection;
- two crawl steps are projected from chain-backed purchases;
- consumer has no prior qualifying purchase at target café;
- target acquisition campaign remains eligible;
- next target-café QR purchase reaches `12 / 12` and unlocks campaign/crawl outcomes through the indexer.

Historical demo setup uses real `ConsumptionProof` validation, plan credits, reserve coverage, and events. It does not temporarily replace `consumptionLog`, expose an administrative mint, or bypass contract economics.

A reset command may stop/recreate local Anvil and restore deterministic database state, but must reject non-`31337` chains.

## 14. Security and privacy

- Every quote mutation requires authenticated consumer or authorized café role as appropriate.
- Server clock controls expiry.
- Exact café/product/operator state is revalidated at confirmation.
- Custodial derivation remains server-only.
- Signer must be the quote's recorded issuing operator.
- No mnemonic, private key, wallet index, complete signature, full Yape reference, or credential-bearing URL reaches client or logs.
- Error redaction covers URLs, tokens, passwords, mnemonics, and private keys.
- Local mnemonic and historical seeding are guarded by chain ID `31337` and development mode.
- Receipt hash and nonce remain unique and replay-safe.
- Browser retries reuse the linked quote/order rather than creating new proof material.

## 15. Testing strategy

Implementation follows test-driven development.

### 15.1 Domain tests

- quote status transitions;
- masked Yape-reference presentation;
- exact mPEN conversion;
- receipt-hash derivation from order ID and reference;
- state mapping from order to quote/UI;
- invalid transition rejection.

### 15.2 Service and database tests

- only application members whose wallet is on-chain authorized can issue a quote;
- quote derives price from approved product;
- expired quote cannot create an order;
- consumer confirmation builds exact proof and uses issuing operator wallet;
- two concurrent confirmations create one order and one job;
- repeat confirmation returns same order;
- no balance/campaign/crawl mutation occurs before indexed evidence;
- permanent relayer failure safely updates order and quote;
- indexed event confirms order/quote and projects history/gamification once;
- repeated indexing changes nothing;
- stale balance behavior never falls back to mock balance.

### 15.3 Live Anvil tests

One gated test executes:

```text
barista quote
→ consumer confirmation
→ queued job
→ relayer submission
→ ConsumptionRecorded
→ PunchIssued
→ indexer confirmation
→ balance increment
→ campaign/crawl projection
```

Additional gated cases cover receipt replay, nonce collision, permanent revert classification, worker restart recovery, indexer restart, reconciliation drift, full rebuild, and exact 11-to-12 demo transition.

### 15.4 UI tests

- terminal accepts reference and renders opaque QR;
- consumer review masks reference and exposes café/product/amount/expiry;
- duplicate taps reuse same order;
- queued/submitted/confirmed/failed states show actionable Spanish copy;
- dashboard displays chain-backed balance and stale state;
- campaign/crawl refresh only after indexed confirmation;
- offline mode blocks confirmation and queues nothing.

### 15.5 Required verification

- normal application test suite;
- gated database and live-chain integration suite;
- TypeScript typecheck;
- Biome over tracked source/config files;
- Next.js production build;
- Forge test suite;
- fresh database migrations and idempotent seed;
- deterministic `pnpm demo:local` browser journey from 11 to 12 PUNCH;
- worker shutdown and restart recovery.

## 16. Acceptance journey

The integration is accepted when this browser-driven local journey succeeds:

1. Start deterministic environment with `pnpm demo:local`.
2. Sign in as seeded consumer and observe chain-backed `11 / 12`, not mock balance.
3. Sign in as seeded target-café barista.
4. Select approved emission product and enter a valid Yape reference.
5. Generate QR/deep link.
6. Open it as seeded consumer and verify café, product, amount, masked reference, and expiry.
7. Confirm once, then repeat the action and observe same order.
8. Observe queued/submitted state while balance remains 11.
9. Worker submits; indexer observes both contract events.
10. Observe confirmed state and balance `12 / 12`.
11. Observe acquisition campaign and crawl completion appear once.
12. Restart worker/app and retain exact state.
13. Force documented local projection drift, run reconciliation, and recover the same balance/progress while reads remain stale during rebuild.
14. Go offline and verify saved reads remain visible while confirmation mutations are disabled.

## 17. Delivery order

Implementation should proceed in independently testable slices:

1. Quote schema/API semantics and on-chain operator validation.
2. Atomic quote-to-order bridge with exact dual signatures.
3. UI hooks and purchase status flow.
4. Indexer-backed history, campaign, and crawl projection.
5. Chain-backed dashboard balance and stale UI.
6. Deterministic local-chain demo orchestration and 11-PUNCH history.
7. Full integration, recovery, reconciliation, and browser verification.

Each slice must preserve existing reward/voucher behavior in explicit full-mock mode. Real-chain mode preserves voucher behavior and disables PUNCH reward burns until their separate chain integration is designed and approved.
