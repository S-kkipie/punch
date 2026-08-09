# Purchase Chain UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing barista QR and consumer PWA purchase journey to the real local-chain purchase, relayer, indexer, reconciler, and PUNCH balance path.

**Architecture:** Keep `consumption_proof` as a compatibility-named short-lived quote, then atomically bridge consumer confirmation into one real `purchase_order` and `relayer_job` signed by the consumer and the exact issuing café operator. Only indexed `ConsumptionRecorded` and `PunchIssued` events confirm purchases, update balance/history, and advance campaign/crawl projections. Real-chain mode disables PostgreSQL-only PUNCH burns while preserving voucher fulfillment; explicit full-mock mode remains available for isolated PWA tests.

**Tech Stack:** TypeScript, Next.js 16, Elysia, Zod, Drizzle ORM, PostgreSQL, React Query/Eden, viem, Vitest, Foundry/Forge, Solidity, Anvil, LogTape.

## Global Constraints

- One valid paid purchase emits exactly one PUNCH.
- Chain is economic authority; PostgreSQL stores authorization, queue state, projections, and read models.
- The indexer is the only bridge from confirmed economic events to balance, history, campaign, and crawl projections.
- Both café and consumer sign the exact existing `ConsumptionProof` field order and EIP-712 domain.
- Café signer is the quote's recorded `issuedByUserId`; never substitute another café member.
- QR payload contains only an opaque quote ID.
- `yapeRef` remains 4–120 characters, stays server-side, and is never logged or returned in full.
- mPEN has 6 decimals; S/1.00 is `1_000_000n`; minimum ticket is `8_000_000n`.
- Proof expiry is at most current server time plus 10 minutes and never later than quote expiry.
- Nonce is a random full uint256; receipt hash is `keccak256(toBytes(`${orderId}:${yapeRef}`))`.
- Quote/order/job/event/balance/history/campaign/crawl effects are idempotent.
- Real-chain balance never falls back to mock `punch_balance_projection`.
- Real-chain mode disables PostgreSQL-only PUNCH reward burns; voucher fulfillment remains mock.
- No browser offline mutation queue.
- Mnemonics, private keys, wallet indices, full signatures, full Yape references, credentials, and credential-bearing URLs never reach clients or logs.
- Local mnemonic and historical demo seeding run only in development on chain ID `31337` and never use real funds.
- Existing relayer permanent-failure classification and retry policy remain unchanged.
- Existing worker cadences remain relayer/indexer 2 seconds, expiry 30 seconds, reconciler 60 seconds.
- Arbitrum Sepolia, real Yape/POS APIs, on-chain PUNCH redemption, and on-chain voucher redemption remain out of scope.
- Follow TDD: write each behavior test first, run it to observe the expected failure, implement minimally, then rerun the focused and related suites.

---

## File Structure

### Quote and authorization

- `src/core/consumption/domain/quotes.ts` — quote statuses, safe view mapping, Yape-reference masking.
- `src/core/chain/server/cafe-authorization.ts` — read-only `CafeRegistry.isAuthorized` check.
- `src/core/consumption/server/services/create-purchase-proof-service.ts` — compatibility route service that now issues quotes.
- `src/core/consumption/server/services/get-purchase-quote-service.ts` — safe consumer quote view.
- `src/core/consumption/server/repository/proofs.ts` — quote persistence and row locking.

### Quote bridge

- `src/core/purchase/server/services/confirm-quote-service.ts` — orchestration and dependency-injected business validation.
- `src/core/purchase/server/repository/quote-bridge-repository.ts` — one PostgreSQL transaction for quote/order/job/link writes.
- `src/core/consumption/server/services/confirm-purchase-service.ts` — compatibility wrapper calling the real bridge.

### Indexed consumer projections

- `src/core/chain/server/indexer/purchase-projection.ts` — confirms linked quote/history/gamification inside indexer transaction.
- `src/core/punch/server/repository/chain-purchase-effects.ts` — transaction-aware campaign/crawl projection functions.
- `src/core/purchase/server/services/get-balance-service.ts` — single chain-backed balance source.

### Runtime mode and demo

- `src/config/server-config.ts` — explicit `CONSUMER_CHAIN_MODE=mock|local` selection.
- `scripts/demo-local.ts` — lifecycle orchestration for DB, Anvil, deploy, bootstrap, historical purchases, worker, and Next.js.
- `src/core/chain/server/bootstrap-local/historical-consumptions.ts` — deterministic valid 11-PUNCH history.

---

### Task 1: Convert Mock Purchase Proofs into Safe Purchase Quotes

**Files:**
- Create: `src/core/consumption/domain/quotes.ts`
- Create: `src/core/chain/server/cafe-authorization.ts`
- Create: `src/core/chain/server/cafe-authorization.test.ts`
- Create: `src/core/consumption/server/services/get-purchase-quote-service.ts`
- Create: `src/core/consumption/server/services/__tests__/get-purchase-quote-service.test.ts`
- Modify: `src/server/drizzle/schemas/consumption-schema.ts`
- Modify: `src/core/consumption/domain/schemas.ts`
- Modify: `src/core/consumption/domain/types.ts`
- Modify: `src/core/consumption/server/repository/proofs.ts`
- Modify: `src/core/consumption/server/services/create-purchase-proof-service.ts`
- Modify: `src/core/consumption/server/services/__tests__/create-purchase-proof-service.test.ts`
- Modify: `src/core/consumption/server/api/routes/create-purchase-proof.route.ts`
- Modify: `src/core/consumption/server/api/routes/get-purchase-proof.route.ts`
- Modify: `src/server/drizzle/__tests__/task-3-schema.test.ts`
- Generate: `drizzle/0010_<generated_name>.sql`
- Generate: `drizzle/meta/0010_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: `assignWallet(userId)`, `deriveUserAccount(walletIndex)`, `localAddresses.cafeRegistry`, `cafeRegistryAbi`, existing café/product repository reads.
- Produces:

```ts
export type PurchaseQuoteStatus =
    | "issued"
    | "submitted"
    | "confirmed"
    | "failed"
    | "expired";

export type PurchaseQuoteView = {
    id: string;
    cafeId: string;
    productId: string;
    amountCentimos: number;
    expiresAt: string;
    status: PurchaseQuoteStatus;
    maskedYapeRef: string;
    purchaseOrderId: string | null;
    failureReason: string | null;
    createdAt: string;
};

export function maskYapeRef(value: string): string;

export async function isAuthorizedCafeOperator(input: {
    chainCafeId: number;
    walletAddress: `0x${string}`;
}): Promise<boolean>;

export async function getPurchaseQuoteService(
    requestingUserId: string,
    quoteId: string,
): AsyncAppResult<PurchaseQuoteView>;
```

- [ ] **Step 1: Write failing quote-domain and schema tests**

Add tests proving safe masking and accepted lifecycle:

```ts
import { describe, expect, it } from "vitest";
import { maskYapeRef } from "../quotes";

it.each([
    ["1234", "••34"],
    ["YAPE-987654", "•••••••••54"],
])("masks every Yape reference except its final two characters", (raw, masked) => {
    expect(maskYapeRef(raw)).toBe(masked);
});
```

Extend schema tests to assert:

```ts
expect(createPurchaseProofSchema.parse({
    productId: crypto.randomUUID(),
    yapeRef: "YAPE-1234",
})).toEqual({
    productId: expect.any(String),
    yapeRef: "YAPE-1234",
});

expect(() => createPurchaseProofSchema.parse({
    productId: crypto.randomUUID(),
    yapeRef: "123",
})).toThrow();
```

Update Drizzle schema assertions to require nullable legacy proof fields, `yape_ref`, unique nullable `purchase_order_id`, `failure_reason`, and all five quote enum values.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm vitest run src/core/consumption/domain/__tests__/schemas.test.ts src/server/drizzle/__tests__/task-3-schema.test.ts
```

Expected: FAIL because `maskYapeRef`, `yapeRef`, quote statuses, and quote linkage do not exist.

- [ ] **Step 3: Implement quote types, masking, and schema**

Create `quotes.ts` with an exhaustive mapper:

```ts
export const purchaseQuoteStatuses = [
    "issued",
    "submitted",
    "confirmed",
    "failed",
    "expired",
] as const;

export type PurchaseQuoteStatus = (typeof purchaseQuoteStatuses)[number];

export function maskYapeRef(value: string): string {
    const visible = value.slice(-2);
    return `${"•".repeat(Math.max(0, value.length - visible.length))}${visible}`;
}
```

Change `createPurchaseProofSchema` input to:

```ts
export const createPurchaseProofSchema = z.object({
    productId: z.string().uuid(),
    yapeRef: z.string().trim().min(4).max(120),
});
```

Change `purchaseProofStatus` and `consumptionProof` fields:

```ts
export const purchaseProofStatus = pgEnum(
    "purchase_proof_status",
    purchaseQuoteStatuses,
);

purchaseOrderId: text("purchase_order_id").references(() => purchaseOrder.id, {
    onDelete: "restrict",
}),
yapeRef: text("yape_ref").notNull(),
receiptHash: text("receipt_hash"),
nonce: text("nonce"),
cafeSignature: text("cafe_signature"),
consumerSignature: text("consumer_signature"),
failureReason: text("failure_reason"),
```

Add partial unique index and state-shape check:

```ts
uniqueIndex("consumption_proof_purchase_order_uq")
    .on(table.purchaseOrderId)
    .where(sql`${table.purchaseOrderId} IS NOT NULL`),
check(
    "consumption_proof_submitted_binding",
    sql`${table.status} NOT IN ('submitted', 'confirmed') OR (${table.consumerUserId} IS NOT NULL AND ${table.purchaseOrderId} IS NOT NULL)`,
),
```

Import `purchaseOrder` from `purchase-schema.ts` into `consumption-schema.ts`; `purchase-schema.ts` does not import consumption schema, so the dependency stays one-way. Define `purchaseOrderId` with `references(() => purchaseOrder.id, { onDelete: "restrict" })` and verify the generated FK in SQL.

- [ ] **Step 4: Write failing operator-authorization and quote-service tests**

Test `isAuthorizedCafeOperator` with an injected public client or exported dependency seam so it calls:

```ts
readContract({
    address: configuredAddresses().cafeRegistry,
    abi: cafeRegistryAbi,
    functionName: "isAuthorized",
    args: [BigInt(chainCafeId), walletAddress],
})
```

Update `create-purchase-proof-service.test.ts` to prove:

- owner/barista app membership alone is insufficient;
- wallet assignment occurs before chain authorization read;
- unauthorized wallet returns 422 and inserts nothing;
- authorized wallet inserts quote with `yapeRef`, no nonce/hash/signatures, and ten-minute TTL;
- amount derives from product price;
- reference never appears in returned DTO.

Add safe GET tests:

```ts
expect(result).toMatchObject({
    ok: true,
    value: {
        status: "issued",
        maskedYapeRef: "•••••••34",
        purchaseOrderId: null,
    },
});
expect(JSON.stringify(result)).not.toContain("YAPE-1234");
```

- [ ] **Step 5: Run service tests and verify RED**

Run:

```bash
pnpm vitest run src/core/chain/server/cafe-authorization.test.ts src/core/consumption/server/services/__tests__/create-purchase-proof-service.test.ts src/core/consumption/server/services/__tests__/get-purchase-quote-service.test.ts
```

Expected: FAIL because quote issuance still builds mock EIP-712 data and safe quote read does not exist.

- [ ] **Step 6: Implement operator validation and quote services**

Remove mock proof construction/signing from quote issuance. The create service must execute:

```ts
const wallet = await d.ensureWallet(baristaUserId);
const authorized = await d.isAuthorizedOperator({
    chainCafeId: cafeRow.chainCafeId,
    walletAddress: wallet.walletAddress,
});
if (!authorized) {
    return err(AppErrors.unprocessableEntity({ targets: ["operator"] }));
}

const row = await d.createQuote({
    cafeId,
    productId: input.productId,
    issuedByUserId: baristaUserId,
    amountCentimos,
    yapeRef: input.yapeRef,
    status: "issued",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
});
```

GET service must expire stale `issued` rows server-side, verify authenticated access, and map only safe fields through `maskYapeRef`.

Keep route paths for compatibility:

```text
POST /api/v1/consumption/:cafeId/purchase-proofs
GET  /api/v1/consumption/purchase-proofs/:proofId
```

- [ ] **Step 7: Generate migration and verify it is stable**

Run:

```bash
pnpm db:generate
pnpm db:generate
```

Expected first run: one new migration. Expected second run: `No schema changes, nothing to migrate`.

Inspect generated SQL for enum additions, nullable legacy fields, quote columns, FK, check, and unique index. Do not hand-edit snapshot JSON.

- [ ] **Step 8: Run Task 1 verification**

Run:

```bash
pnpm vitest run src/core/consumption/domain src/core/consumption/server/services/__tests__/create-purchase-proof-service.test.ts src/core/consumption/server/services/__tests__/get-purchase-quote-service.test.ts src/core/chain/server/cafe-authorization.test.ts src/server/drizzle/__tests__/task-3-schema.test.ts
pnpm typecheck
pnpm biome check src/core/consumption src/core/chain/server/cafe-authorization.ts src/server/drizzle/schemas/consumption-schema.ts
```

Expected: all pass.

- [ ] **Step 9: Commit Task 1**

```bash
git add drizzle src/core/consumption src/core/chain/server/cafe-authorization.ts src/core/chain/server/cafe-authorization.test.ts src/server/drizzle/schemas/consumption-schema.ts src/server/drizzle/__tests__/task-3-schema.test.ts
git commit -m "feat(consumption): issue chain-authorized purchase quotes"
```

---

### Task 2: Atomically Bridge Consumer Confirmation into Real Purchase Queue

**Files:**
- Create: `src/core/purchase/server/repository/quote-bridge-repository.ts`
- Create: `src/core/purchase/server/services/confirm-quote-service.ts`
- Create: `src/core/purchase/server/services/__tests__/confirm-quote-service.test.ts`
- Create: `src/core/purchase/server/repository/__tests__/quote-bridge-repository.integration.test.ts`
- Modify: `src/core/consumption/server/services/confirm-purchase-service.ts`
- Modify: `src/core/consumption/server/services/__tests__/confirm-purchase-service.test.ts`
- Modify: `src/core/consumption/server/api/routes/confirm-purchase.route.ts`
- Modify: `src/core/purchase/server/repository/purchase-repository.ts`
- Modify: `src/core/purchase/domain/types.ts`
- Modify: `src/core/purchase/domain/schemas.ts`

**Interfaces:**
- Consumes: `ConsumptionProof`, `serializeProof`, `signProofAs`, `buildReceiptHash`, `randomNonce`, wallet repository, quote fields from Task 1.
- Produces:

```ts
export type QuoteBridgeResult = {
    order: PurchaseOrderView;
    quote: PurchaseQuoteView;
    outcome: "created" | "existing";
};

export async function confirmQuoteService(
    consumerUserId: string,
    quoteId: string,
    deps?: Partial<ConfirmQuoteDeps>,
): AsyncAppResult<QuoteBridgeResult>;

export async function bridgeQuoteToOrder(input: {
    quoteId: string;
    consumerUserId: string;
    now: Date;
    orderId: string;
    proof: ConsumptionProof;
    cafeSignature: `0x${string}`;
    userSignature: `0x${string}`;
}): Promise<QuoteBridgeResult>;
```

- [ ] **Step 1: Write failing service tests for exact proof and signer binding**

Build an `issued` quote fixture and assert:

```ts
expect(signProof).toHaveBeenNthCalledWith(
    1,
    consumerWallet.walletIndex,
    expectedProof,
);
expect(signProof).toHaveBeenNthCalledWith(
    2,
    issuingOperatorWallet.walletIndex,
    expectedProof,
);
expect(expectedProof).toMatchObject({
    cafeId: BigInt(cafe.chainCafeId),
    user: consumerWallet.walletAddress,
    productId: BigInt(product.chainProductId),
    amount: BigInt(quote.amountCentimos) * 10_000n,
    receiptHash: buildReceiptHash(orderId, quote.yapeRef),
});
expect(expectedProof.expiry).toBeLessThanOrEqual(
    BigInt(Math.floor(quote.expiresAt.getTime() / 1000)),
);
```

Also assert expired quote, changed membership, changed operator authorization, missing mapping, and wrong consumer are rejected before repository mutation.

- [ ] **Step 2: Run service test and verify RED**

Run:

```bash
pnpm vitest run src/core/purchase/server/services/__tests__/confirm-quote-service.test.ts
```

Expected: FAIL because `confirmQuoteService` does not exist.

- [ ] **Step 3: Implement dependency-injected confirmation orchestration**

Use a focused service flow:

```ts
const quote = await d.findQuote(quoteId);
if (!quote) return err(AppErrors.notFound({ targets: ["quoteId"] }));
if (quote.purchaseOrderId) return ok(await d.getExistingBridge(quote));
if (quote.status !== "issued" || quote.expiresAt.getTime() <= now.getTime()) {
    return err(AppErrors.conflict({ targets: ["status"] }));
}

await d.ensureCurrentCafeAuthorization(quote);
const consumerWallet = await d.ensureWallet(consumerUserId);
const operatorWallet = await d.findUserWallet(quote.issuedByUserId);
```

Build proof once, sign exact same object twice, then pass all immutable values to repository transaction. Never log proof signatures or `yapeRef`.

- [ ] **Step 4: Write failing PostgreSQL concurrency test**

Run two confirmations against same quote with `Promise.all`. Assert:

```ts
expect(new Set(results.map((result) => result.order.id)).size).toBe(1);
expect(await countPurchaseOrdersForQuote(quote.id)).toBe(1);
expect(await countRelayerJobsForOrder(results[0].order.id)).toBe(1);
```

Also assert transaction rollback leaves quote `issued` and creates zero orders/jobs when job insert fails.

- [ ] **Step 5: Run repository integration test and verify RED**

Run:

```bash
PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/purchase/server/repository/__tests__/quote-bridge-repository.integration.test.ts
```

Expected: FAIL because no quote lock/bridge transaction exists.

- [ ] **Step 6: Implement atomic bridge repository**

Use `database.transaction` and row lock:

```ts
const [quote] = await tx
    .select()
    .from(consumptionProof)
    .where(eq(consumptionProof.id, input.quoteId))
    .for("update");

if (quote.purchaseOrderId) {
    return loadExistingBridge(tx, quote);
}
```

Inside same transaction:

1. Recheck `issued` and expiry against `input.now`.
2. Insert purchase order directly as `queued` with the precomputed proof economics.
3. Insert one `relayer_job` with serialized proof and both signatures.
4. Update quote with consumer ID, order ID, and `submitted`.
5. Return mapped order/quote and `outcome: "created"`.

Handle unique-conflict loser by loading existing bridge and returning `outcome: "existing"`; do not recompute a second order.

- [ ] **Step 7: Replace mock consumer confirmation path**

Change compatibility service to:

```ts
export async function confirmPurchaseService(
    consumerUserId: string,
    input: { proofId: string },
): AsyncAppResult<QuoteBridgeResult> {
    return confirmQuoteService(consumerUserId, input.proofId);
}
```

Remove `PostgresMockConsumerChain.submitConsumption` from real quote confirmation. Keep mock adapter code for explicit full-mock mode tests only.

Update route response schema to include quote and real order state. Preserve endpoint:

```text
POST /api/v1/consumption/purchases/confirm
```

- [ ] **Step 8: Run Task 2 verification**

Run:

```bash
pnpm vitest run src/core/purchase/server/services/__tests__/confirm-quote-service.test.ts src/core/consumption/server/services/__tests__/confirm-purchase-service.test.ts src/core/chain/server/proof/__tests__/proof.test.ts
PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/purchase/server/repository/__tests__/quote-bridge-repository.integration.test.ts
pnpm typecheck
pnpm biome check src/core/purchase src/core/consumption/server/services/confirm-purchase-service.ts
```

Expected: all pass.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/core/purchase src/core/consumption/server/services/confirm-purchase-service.ts src/core/consumption/server/services/__tests__/confirm-purchase-service.test.ts src/core/consumption/server/api/routes/confirm-purchase.route.ts
git commit -m "feat(purchase): bridge QR confirmation to relayer queue"
```

---

### Task 3: Connect Terminal and Consumer Purchase UI to Real Order Status

**Files:**
- Create: `src/core/consumption/client/purchase-status.ts`
- Create: `src/core/consumption/client/__tests__/purchase-status.test.ts`
- Modify: `src/core/consumption/client/hooks.ts`
- Modify: `src/core/consumption/client/ui/transaction-status.tsx`
- Modify: `src/app/(app)/(workspace)/cafe/[cafeId]/terminal/page.tsx`
- Modify: `src/app/(app)/(workspace)/cafe/[cafeId]/terminal/__tests__/terminal-page.test.tsx`
- Modify: `src/app/(app)/(consumer)/purchase/[proofId]/page.tsx`
- Modify: `src/app/(app)/(consumer)/purchase/[proofId]/__tests__/purchase-page.test.tsx`

**Interfaces:**
- Consumes: safe `PurchaseQuoteView`, `QuoteBridgeResult`, existing Eden client and React Query provider.
- Produces:

```ts
export type UiPurchaseState =
    | "issued"
    | "queued"
    | "submitted"
    | "confirmed"
    | "failed"
    | "expired";

export function purchaseQuoteQueryKey(quoteId: string): readonly unknown[];
export function purchaseOrderQueryKey(orderId: string): readonly unknown[];
export function toUiPurchaseState(input: {
    quoteStatus: PurchaseQuoteStatus;
    orderStatus?: PurchaseOrderStatus;
}): UiPurchaseState;
export function purchaseStatusCopy(status: UiPurchaseState): {
    label: string;
    hint: string;
};
```

- [ ] **Step 1: Write failing status mapping and copy tests**

Assert exhaustive mappings and Spanish copy:

```ts
expect(toUiPurchaseState({ quoteStatus: "submitted", orderStatus: "queued" }))
    .toBe("queued");
expect(toUiPurchaseState({ quoteStatus: "submitted", orderStatus: "submitted" }))
    .toBe("submitted");
expect(purchaseStatusCopy("expired")).toEqual({
    label: "Código vencido",
    hint: "Pide al barista uno nuevo.",
});
```

- [ ] **Step 2: Run status tests and verify RED**

Run:

```bash
pnpm vitest run src/core/consumption/client/__tests__/purchase-status.test.ts
```

Expected: FAIL because mapping module does not exist.

- [ ] **Step 3: Implement status mapping and query hooks**

Add query keys:

```ts
export const purchaseQuoteQueryKey = (quoteId: string) =>
    ["consumption", "quote", quoteId] as const;
export const purchaseOrderQueryKey = (orderId: string) =>
    ["purchase", "order", orderId] as const;
```

After confirm mutation succeeds:

- cache returned quote/order;
- disable confirm button immediately;
- poll order every two seconds only while `queued` or `submitted`;
- stop on `confirmed`, `failed`, or `expired`;
- invalidate quote, dashboard, history, campaign, and crawl keys only after terminal response.

Duplicate taps reuse current mutation/order and never call create twice.

- [ ] **Step 4: Write failing terminal UI tests**

Assert terminal:

- renders a `Referencia Yape` input;
- enforces 4–120 characters;
- submits `{ productId, yapeRef }`;
- never calls `crypto.getRandomValues` or sends `receiptHash`;
- QR data contains `/purchase/{quoteId}` only.

Representative assertion:

```ts
expect(createQuote).toHaveBeenCalledWith({
    cafeId,
    productId,
    yapeRef: "YAPE-1234",
});
expect(screen.queryByText("YAPE-1234")).not.toBeInTheDocument();
```

- [ ] **Step 5: Run terminal test and verify RED**

Run:

```bash
pnpm vitest run 'src/app/(app)/(workspace)/cafe/[cafeId]/terminal/__tests__/terminal-page.test.tsx'
```

Expected: FAIL because terminal still generates client receipt hash.

- [ ] **Step 6: Implement terminal quote form**

Replace receipt-hash generation with controlled Yape-reference input. Clear reference from component state after successful quote issuance. Keep QR/deep-link fallback and existing accessibility behavior.

- [ ] **Step 7: Write failing consumer page tests**

Assert page renders café, product, amount, expiry, masked reference, no full reference, and exact status lifecycle. Test two rapid clicks result in one mutation. Test offline state disables confirmation with existing offline copy.

```ts
expect(screen.getByText("•••••••34")).toBeVisible();
expect(screen.queryByText("YAPE-1234")).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "Confirmar compra" })).toBeDisabled();
```

- [ ] **Step 8: Run consumer page test and verify RED**

Run:

```bash
pnpm vitest run 'src/app/(app)/(consumer)/purchase/[proofId]/__tests__/purchase-page.test.tsx'
```

Expected: FAIL because page still renders mock transaction lifecycle.

- [ ] **Step 9: Implement safe quote review and real-order polling UI**

Use safe quote GET and bridge confirm mutation. Render tx hash only when available and truncated. Keep wallet, signatures, chain ID, and gas hidden. On failure, map permanent safe reason to actionable copy and do not create a fresh quote/order automatically.

- [ ] **Step 10: Run Task 3 verification**

Run:

```bash
pnpm vitest run src/core/consumption/client 'src/app/(app)/(workspace)/cafe/[cafeId]/terminal/__tests__/terminal-page.test.tsx' 'src/app/(app)/(consumer)/purchase/[proofId]/__tests__/purchase-page.test.tsx'
pnpm typecheck
pnpm biome check src/core/consumption/client 'src/app/(app)/(workspace)/cafe/[cafeId]/terminal' 'src/app/(app)/(consumer)/purchase/[proofId]'
```

Expected: all pass.

- [ ] **Step 11: Commit Task 3**

```bash
git add src/core/consumption/client 'src/app/(app)/(workspace)/cafe/[cafeId]/terminal' 'src/app/(app)/(consumer)/purchase/[proofId]'
git commit -m "feat(consumer): connect QR purchases to real order status"
```

---

### Task 4: Project Indexed Purchases into Quote, History, Campaign, and Crawl State

**Files:**
- Create: `src/core/chain/server/indexer/purchase-projection.ts`
- Create: `src/core/chain/server/indexer/__tests__/purchase-projection.test.ts`
- Create: `src/core/punch/server/repository/chain-purchase-effects.ts`
- Create: `src/core/punch/server/repository/__tests__/chain-purchase-effects.integration.test.ts`
- Modify: `src/core/chain/server/indexer/apply-event.ts`
- Modify: `src/core/chain/server/indexer/__tests__/apply-event.test.ts`
- Modify: `src/core/chain/server/indexer/__tests__/indexer.integration.test.ts`
- Modify: `src/server/drizzle/schemas/consumption-schema.ts`
- Modify: `src/server/drizzle/schemas/punch-schema.ts`
- Modify: `src/core/consumption/server/services/list-history-service.ts`
- Modify: `src/core/consumption/server/services/__tests__/list-history-service.test.ts`
- Generate: next Drizzle migration/snapshot/journal entry.

**Interfaces:**
- Consumes: transaction-scoped `applyChainEvent`, purchase/quote linkage, existing campaign/crawl eligibility rules.
- Produces:

```ts
export type ConfirmedConsumptionProjectionInput = {
    orderId: string;
    txHash: `0x${string}`;
    logIndex: number;
    blockNumber: bigint;
};

export async function applyConfirmedConsumptionProjection(
    tx: IndexerTransaction,
    input: ConfirmedConsumptionProjectionInput,
): Promise<void>;

export async function applyChainPurchaseEffects(
    tx: IndexerTransaction,
    input: {
        purchaseOrderId: string;
        consumerUserId: string;
        cafeId: string;
        productId: string;
        transactionHash: string;
        logIndex: number;
        confirmedAt: Date;
    },
): Promise<void>;
```

- [ ] **Step 1: Write failing projection unit test**

Given matching order/quote and `ConsumptionRecorded`, assert transaction collaborator calls occur exactly once:

```ts
expect(confirmOrder).toHaveBeenCalledWith(tx, order.id, txHash);
expect(confirmQuote).toHaveBeenCalledWith(tx, quote.id);
expect(upsertHistory).toHaveBeenCalledWith(tx, expect.objectContaining({
    operation: "emission",
    status: "confirmed",
    chainTxId: txHash,
    purchaseOrderId: order.id,
}));
expect(applyPurchaseEffects).toHaveBeenCalledTimes(1);
```

A nonmatching event still records chain projection but does not invent quote/history effects.

- [ ] **Step 2: Run projection test and verify RED**

Run:

```bash
pnpm vitest run src/core/chain/server/indexer/__tests__/purchase-projection.test.ts
```

Expected: FAIL because projection orchestrator does not exist.

- [ ] **Step 3: Add provenance schema and constraints**

Add nullable chain provenance to emission history and chain-derived gamification records:

```ts
purchaseOrderId: text("purchase_order_id").references(() => purchaseOrder.id),
transactionHash: text("transaction_hash"),
logIndex: integer("log_index"),
```

Add unique indexes shaped to each table, including:

```ts
uniqueIndex("consumer_transaction_purchase_order_uq")
    .on(table.purchaseOrderId)
    .where(sql`${table.purchaseOrderId} IS NOT NULL`),
```

Create `chain_purchase_effect` in `punch-schema.ts` with one row per projected effect:

```ts
export const chainPurchaseEffectKind = pgEnum("chain_purchase_effect_kind", [
    "campaign_qualification",
    "crawl_step",
]);

export const chainPurchaseEffect = pgTable(
    "chain_purchase_effect",
    {
        id: text("id").primaryKey(),
        purchaseOrderId: text("purchase_order_id")
            .notNull()
            .references(() => purchaseOrder.id, { onDelete: "cascade" }),
        kind: chainPurchaseEffectKind("kind").notNull(),
        targetId: text("target_id").notNull(),
        transactionHash: text("transaction_hash").notNull(),
        logIndex: integer("log_index").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("chain_purchase_effect_order_kind_target_uq").on(
            table.purchaseOrderId,
            table.kind,
            table.targetId,
        ),
    ],
);
```

This row is projection provenance, not economic authority.

Generate migration twice and require stable second run.

- [ ] **Step 4: Implement transaction-aware purchase projection**

Move matching order confirmation out of ad hoc `apply-event.ts` code into `applyConfirmedConsumptionProjection`. Use passed `tx` for every query/write. Upsert one confirmed `consumer_transaction` with idempotency key:

```ts
`chain_emission:${purchaseOrderId}`
```

Then call existing campaign/crawl eligibility rules through transaction-aware repository functions. Do not call global `db` from inside indexer transaction.

- [ ] **Step 5: Write failing database idempotency and eligibility tests**

Test:

- first event confirms order/quote and creates one history row;
- duplicate event creates no duplicate row/effect;
- qualifying first target-café purchase unlocks acquisition voucher once;
- ordered distinct café purchase advances one crawl step;
- wrong order, expired campaign, repeated café, and repeated order do not advance;
- no purchase effect is applied before indexer confirmation.

- [ ] **Step 6: Run integration tests and verify RED**

Run:

```bash
PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/punch/server/repository/__tests__/chain-purchase-effects.integration.test.ts src/core/chain/server/indexer/__tests__/indexer.integration.test.ts
```

Expected: FAIL because indexer does not project gamification/history.

- [ ] **Step 7: Implement campaign/crawl projection repository**

Adapt existing campaign/crawl functions to accept `tx`. Insert provenance before applying an effect with `onConflictDoNothing`; proceed only when insertion returns a row. This makes duplicate event delivery a no-op without relying on in-memory state.

Ensure voucher unlocks remain separate from PUNCH balance and do not call mock chain consumption methods.

- [ ] **Step 8: Update history reads**

Map indexed emission rows using real tx hash and quote/product metadata. Existing mock-mode rows remain readable, but real-chain rows are identified by non-null `purchaseOrderId` and chain provenance.

- [ ] **Step 9: Run Task 4 verification**

Run:

```bash
pnpm vitest run src/core/chain/server/indexer/__tests__/purchase-projection.test.ts src/core/chain/server/indexer/__tests__/apply-event.test.ts src/core/consumption/server/services/__tests__/list-history-service.test.ts
PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/punch/server/repository/__tests__/chain-purchase-effects.integration.test.ts src/core/chain/server/indexer/__tests__/indexer.integration.test.ts
pnpm typecheck
pnpm biome check src/core/chain/server/indexer src/core/punch/server/repository src/core/consumption/server/services/list-history-service.ts src/server/drizzle/schemas
```

Expected: all pass.

- [ ] **Step 10: Commit Task 4**

```bash
git add drizzle src/core/chain/server/indexer src/core/punch/server/repository src/core/consumption/server/services/list-history-service.ts src/core/consumption/server/services/__tests__/list-history-service.test.ts src/server/drizzle/schemas
git commit -m "feat(indexer): project chain purchases into consumer state"
```

---

### Task 5: Make Dashboard Balance Chain-Backed and Separate Runtime Modes

**Files:**
- Modify: `src/config/server-config.ts`
- Modify: `src/config/__tests__/server-config.test.ts`
- Modify: `src/core/purchase/server/services/get-balance-service.ts`
- Modify: `src/core/purchase/server/services/__tests__/get-balance-service.test.ts`
- Modify: `src/core/punch/server/repository/balance.ts`
- Modify: `src/core/punch/server/services/get-dashboard-service.ts`
- Create: `src/core/punch/server/services/__tests__/get-dashboard-service.test.ts`
- Modify: `src/core/punch/domain/schemas.ts`
- Modify: `src/core/punch/client/hooks.ts`
- Modify: `src/app/(app)/(consumer)/home/page.tsx`
- Modify: `src/app/(app)/(consumer)/redeem/[productId]/page.tsx`
- Modify/add: consumer home and redemption page tests.

**Interfaces:**
- Consumes: existing `isChainProjectionStale(database)`, user-wallet resolution, `projection_punch_balance`.
- Produces:

```ts
export type ConsumerChainMode = "mock" | "local";

export type ChainBackedBalance = {
    punchBalance: number;
    stale: boolean;
};

export async function getChainBackedBalance(
    userId: string,
    deps?: Partial<BalanceDeps>,
): AsyncAppResult<ChainBackedBalance>;
```

- [ ] **Step 1: Write failing config and balance tests**

Config tests prove:

```ts
expect(parseConsumerChainMode(undefined, "development")).toBe("local");
expect(parseConsumerChainMode("mock", "test")).toBe("mock");
expect(() => parseConsumerChainMode("remote", "development")).toThrow();
```

Balance tests prove:

- missing status row → `{ stale: true }`;
- paused status → stale;
- green status + missing wallet balance → zero/nonstale;
- projected address balance → exact integer;
- mock balance repository is never called in local mode.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm vitest run src/config/__tests__/server-config.test.ts src/core/purchase/server/services/__tests__/get-balance-service.test.ts src/core/punch/server/services/__tests__/get-dashboard-service.test.ts
```

Expected: FAIL because dashboard still reads mock projection and mode is absent.

- [ ] **Step 3: Add explicit chain mode and single balance service**

Add validated server config:

```ts
consumerChainMode: z.enum(["mock", "local"]).default(
    process.env.NODE_ENV === "test" ? "mock" : "local",
),
```

Keep env name `CONSUMER_CHAIN_MODE`. Dashboard service calls `getChainBackedBalance` in local mode and existing mock repository only in mock mode. Do not duplicate stale logic.

Extend dashboard schema with `stale: boolean` while preserving integer PUNCH fields.

- [ ] **Step 4: Write failing UI stale and redemption-mode tests**

Home test:

```ts
expect(screen.getByText("Actualizando desde la cadena")).toBeVisible();
expect(screen.getByText("11 / 12")).toBeVisible();
```

Real-chain redemption test:

```ts
expect(screen.getByRole("button", { name: /canjear/i })).toBeDisabled();
expect(screen.getByText(/redención on-chain aún no disponible/i)).toBeVisible();
```

Mock-mode test preserves existing fixed-12 journey. Voucher actions remain enabled in both modes when otherwise eligible.

- [ ] **Step 5: Run UI tests and verify RED**

Run:

```bash
pnpm vitest run 'src/app/(app)/(consumer)/home' 'src/app/(app)/(consumer)/redeem/[productId]'
```

Expected: FAIL because stale banner and mode gate do not exist.

- [ ] **Step 6: Implement stale UI and PUNCH redemption mode gate**

React Query keeps previous dashboard data during refetch. Render stale notice with `role="status"`. In local mode, disable PUNCH redemption mutation before any request; do not alter voucher redemption paths.

- [ ] **Step 7: Run Task 5 verification**

Run:

```bash
pnpm vitest run src/config src/core/purchase/server/services/__tests__/get-balance-service.test.ts src/core/punch 'src/app/(app)/(consumer)/home' 'src/app/(app)/(consumer)/redeem/[productId]'
pnpm typecheck
pnpm biome check src/config src/core/purchase/server/services/get-balance-service.ts src/core/punch 'src/app/(app)/(consumer)/home' 'src/app/(app)/(consumer)/redeem/[productId]'
```

Expected: all pass.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/config src/core/purchase/server/services/get-balance-service.ts src/core/purchase/server/services/__tests__/get-balance-service.test.ts src/core/punch 'src/app/(app)/(consumer)/home' 'src/app/(app)/(consumer)/redeem/[productId]'
git commit -m "feat(punch): read consumer balance from chain projection"
```

---

### Task 6: Build Deterministic Local Demo with Eleven Real Historical PUNCH

**Files:**
- Create: `src/core/chain/server/bootstrap-local/historical-consumptions.ts`
- Create: `src/core/chain/server/bootstrap-local/__tests__/historical-consumptions.test.ts`
- Create: `scripts/demo-local.ts`
- Create: `src/core/chain/server/bootstrap-local/__tests__/demo-local.test.ts`
- Create: `src/core/worker/error-redaction.ts`
- Create: `src/core/worker/__tests__/error-redaction.test.ts`
- Modify: `scripts/worker.ts`
- Modify: `src/core/chain/server/bootstrap-local/service.ts`
- Modify: `src/core/chain/server/bootstrap-local/repository.ts`
- Modify: `src/core/chain/server/bootstrap-local/__tests__/service.test.ts`
- Modify: `scripts/bootstrap-local.ts`
- Modify: `scripts/dev-chain.ts`
- Modify: `scripts/seed.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing deploy/bootstrap/proof helpers, seeded identities/cafés/products, Anvil JSON-RPC time methods, worker startup.
- Produces:

```ts
export async function assertLocalChain31337(
    publicClient: Pick<PublicClient, "getChainId">,
): Promise<void>;

export async function seedHistoricalConsumptions(input: {
    consumerUserId: string;
    count: 11;
    targetCafeId: string;
}): Promise<readonly `0x${string}`[]>;

export async function runDemoLocal(options?: {
    spawn: typeof spawn;
    signal?: AbortSignal;
}): Promise<void>;
```

- [ ] **Step 1: Write failing local-chain guard and historical-plan tests**

Test guard:

```ts
await expect(assertLocalChain31337(clientReturning(421614))).rejects.toThrow(
    "demo seeding requires chain id 31337",
);
```

Test deterministic schedule has 11 unique receipt hashes/nonces, excludes target café, never exceeds three purchases per `(cafe,user,UTC day)`, and uses only approved emission products.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/core/chain/server/bootstrap-local/__tests__/historical-consumptions.test.ts
```

Expected: FAIL because guard/scheduler do not exist.

- [ ] **Step 3: Implement operator bootstrap and historical consumption seeding**

Extend bootstrap records to include seeded owner/barista wallet addresses. For each café, call registry operator authorization idempotently and verify `isAuthorized` afterward.

Historical seeding must:

1. Assert development and chain ID 31337.
2. Use real mapped cafés/products and assigned consumer/operator accounts.
3. Fund/activate plans through existing bootstrap economics.
4. Build and sign exact `ConsumptionProof` values.
5. Submit through `ConsumptionLog.recordConsumption`.
6. Wait for successful receipts and fail loudly on revert.
7. Use Anvil time advancement only between daily batches.
8. Restore deterministic final timestamp accepted by current proof TTL checks.
9. Confirm `PunchVault.balanceOf(consumer) === 11n`.
10. Leave target café without prior consumer purchase.

Do not replace `PunchVault.consumptionLog`, add mint APIs, or write projection balances directly.

- [ ] **Step 4: Write failing demo orchestrator tests**

Use injected `spawn` to assert exact phase ordering and cleanup:

```ts
expect(phases).toEqual([
    "db:migrate",
    "db:seed",
    "chain:anvil",
    "chain:deploy",
    "chain:bootstrap-local",
    "chain:seed-history",
    "chain:index",
    "chain:reconcile",
    "worker",
    "dev",
]);
```

Assert failure in any setup phase terminates started children, signal waits for worker/app drain, unavailable DB fails before Anvil, and nonlocal chain aborts.

- [ ] **Step 5: Run orchestrator test and verify RED**

Run:

```bash
pnpm vitest run src/core/chain/server/bootstrap-local/__tests__/demo-local.test.ts
```

Expected: FAIL because `scripts/demo-local.ts` and package script do not exist.

- [ ] **Step 6: Implement demo orchestration**

Add package commands:

```json
{
  "demo:local": "node --conditions=react-server --import tsx --env-file=.env scripts/demo-local.ts",
  "chain:seed-history": "node --conditions=react-server --import tsx --env-file=.env scripts/bootstrap-local.ts --seed-history"
}
```

Move `sanitizeMessage` and `normalizeError` from `scripts/worker.ts` into `src/core/worker/error-redaction.ts`, export both, and keep existing worker tests green. `demo-local.ts` must use argument arrays with `spawn`, never a shell-concatenated command, and must sanitize child errors through `normalizeError`. Wait for Anvil readiness by polling `eth_chainId`, not fixed sleep. Run setup phases serially, then worker/app concurrently. Forward SIGINT/SIGTERM once and await exits.

After history seeding, force index from block zero and call reconciliation once; require green before starting UI.

- [ ] **Step 7: Run Task 6 verification**

Run:

```bash
pnpm vitest run src/core/chain/server/bootstrap-local/__tests__ src/core/worker/__tests__/worker.test.ts
pnpm typecheck
pnpm biome check scripts/demo-local.ts scripts/bootstrap-local.ts src/core/chain/server/bootstrap-local package.json
```

With local PostgreSQL available, run:

```bash
pnpm demo:local
```

Expected: app starts with consumer chain balance 11, projection green, seeded barista on-chain authorized, and no secret output. Stop with SIGINT and verify child processes exit.

- [ ] **Step 8: Commit Task 6**

```bash
git add package.json scripts/demo-local.ts scripts/bootstrap-local.ts scripts/dev-chain.ts scripts/seed.ts scripts/worker.ts src/core/chain/server/bootstrap-local src/core/worker/error-redaction.ts src/core/worker/__tests__/error-redaction.test.ts
git commit -m "feat(demo): orchestrate deterministic local chain journey"
```

---

### Task 7: Rebuild Chain-Derived Consumer State and Verify Full Recovery Journey

**Files:**
- Create: `src/core/chain/server/reconciler/purchase-projection-rebuild.ts`
- Create: `src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts`
- Create: `src/core/chain/server/__tests__/purchase-journey.live.test.ts`
- Modify: `src/core/chain/server/reconciler/reconciler.ts`
- Modify: `src/core/chain/server/reconciler/__tests__/reconciler.test.ts`
- Modify: `src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts`
- Modify: `src/core/chain/server/indexer/indexer.ts`
- Modify: `src/core/chain/server/relayer/__tests__/relayer.integration.test.ts`
- Modify: `src/core/worker/__tests__/worker.test.ts`

**Interfaces:**
- Consumes: chain provenance from Task 4, current projection pause/reindex lifecycle, demo seed from Task 6.
- Produces:

```ts
export async function clearChainDerivedPurchaseProjections(
    database: typeof db,
): Promise<void>;
```

- [ ] **Step 1: Write failing rebuild integration test**

Seed:

- confirmed linked order/quote;
- indexed emission history;
- balance projection;
- campaign voucher/effect;
- crawl effect;
- unrelated manual/mock voucher state.

Call clear function and assert chain-derived state is removed/reset while definitions and unrelated voucher state remain. Then reindex from block zero and assert exact prior state returns once.

- [ ] **Step 2: Run rebuild test and verify RED**

Run:

```bash
PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts
```

Expected: FAIL because reconciler only clears existing economic projection tables.

- [ ] **Step 3: Implement chain-derived projection clearing**

Inside one DB transaction while projection remains paused:

1. Delete chain-derived campaign/crawl effect provenance.
2. Reverse/delete only unlock/progress rows attributable to those effects.
3. Delete indexed emission `consumer_transaction` rows.
4. Reset linked quotes from confirmed to submitted when their order will be replay-confirmed.
5. Reset confirmed purchase projections to submitted without changing relayer jobs already confirmed.
6. Clear `projection_consumption`, `projection_punch_balance`, and `projection_cafe_credit`.
7. Reset cursor to zero.

Do not delete quote authorization, purchase order economics, campaign/crawl definitions, manually created vouchers, redemption requests, or relayer evidence.

Wire this function into reconciler drift path before forced full index. Keep stale/paused true through replay and recheck.

- [ ] **Step 4: Write failing live end-to-end journey**

Gated test must execute real components:

```text
seeded balance 11
→ authorized barista creates quote
→ consumer confirms twice
→ one order/job queued
→ relayer submits
→ ConsumptionRecorded + PunchIssued mined
→ indexer confirms quote/order/history
→ balance 12
→ campaign and crawl effects once
→ worker/repository restart recovery preserves state
→ injected projection drift pauses and rebuilds to same state
```

Assert full Yape reference/signatures never appear in API JSON or captured logs.

- [ ] **Step 5: Run live test and verify RED**

Run:

```bash
PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1 pnpm vitest run src/core/chain/server/__tests__/purchase-journey.live.test.ts
```

Expected: FAIL at first missing recovery/rebuild integration behavior.

- [ ] **Step 6: Complete recovery wiring minimally**

Use existing relayer startup recovery and worker loop APIs; do not create a second worker. Add only missing hooks needed for linked quote failure/confirmation convergence and rebuild replay.

Permanent relayer failure updates linked quote with the same safe reason in the same DB transaction as order/job failure. Submitted recovery retains current transaction-receipt rules and only handles actual `TransactionReceiptNotFoundError` as not-found.

- [ ] **Step 7: Run focused recovery verification**

Run:

```bash
pnpm vitest run src/core/worker/__tests__/worker.test.ts src/core/chain/server/reconciler/__tests__/reconciler.test.ts
PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts src/core/chain/server/reconciler/__tests__/reconciler.integration.test.ts src/core/chain/server/relayer/__tests__/relayer.integration.test.ts
PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1 pnpm vitest run src/core/chain/server/__tests__/purchase-journey.live.test.ts
```

Expected: all pass.

- [ ] **Step 8: Run complete application and contract verification**

Run:

```bash
pnpm test
PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1 pnpm test
pnpm typecheck
pnpm check
pnpm build
pnpm contracts:test
pnpm db:generate
```

Expected:

- all normal and gated tests pass;
- no TypeScript/Biome errors in tracked project files;
- Next production build passes;
- Forge suite passes;
- Drizzle reports `No schema changes, nothing to migrate`.

Use a fresh PostgreSQL database to verify:

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:seed
```

Expected: migrations pass and second seed is idempotent.

- [ ] **Step 9: Run browser acceptance journey**

Start:

```bash
pnpm demo:local
```

Verify:

1. Consumer home shows chain-backed `11 / 12`.
2. Seeded target barista creates QR with valid reference.
3. Consumer sees masked reference and confirms.
4. Duplicate click returns same order.
5. Balance stays 11 while queued/submitted.
6. Indexed confirmation changes balance to `12 / 12`.
7. Acquisition campaign and crawl complete once.
8. App/worker restart preserves state.
9. Documented local drift injection marks reads stale and rebuilds exact state.
10. Offline mode keeps reads and blocks confirmation.

Record commands/results in Task 7 SDD report; do not commit screenshots or logs unless explicitly requested.

- [ ] **Step 10: Commit Task 7**

```bash
git add src/core/chain/server/reconciler src/core/chain/server/relayer src/core/chain/server/indexer src/core/chain/server/__tests__/purchase-journey.live.test.ts src/core/worker/__tests__/worker.test.ts
git commit -m "test(chain): verify purchase projection recovery journey"
```

---

## Final Review Checklist

- [ ] Every production behavior was preceded by a focused failing test.
- [ ] Quote QR contains only opaque ID.
- [ ] Full Yape reference never appears in response/log snapshots.
- [ ] Exact issuing operator wallet signs café side.
- [ ] Concurrent confirmation creates one order and job.
- [ ] No economic UI update occurs before indexed chain evidence.
- [ ] Dashboard reads only chain projection in local mode.
- [ ] Real-chain PUNCH redemption is disabled; vouchers remain separate.
- [ ] Duplicate/replayed events produce no duplicate projection effect.
- [ ] Reconciler rebuild reproduces exact chain-derived consumer state.
- [ ] Demo guard rejects every non-31337 chain.
- [ ] Normal, gated, live-chain, typecheck, Biome, build, Forge, migration, and seed checks pass.
