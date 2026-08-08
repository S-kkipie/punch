# PUNCH Consumer PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the consumer-facing PUNCH PWA (home, discover, scan, purchase confirmation, history, PUNCH redemption, campaigns, coffee crawls) on top of a PostgreSQL-backed mock on-chain adapter, plus the minimal café QR terminal and redemption inbox, so the two-role demo in spec §13 runs end to end.

**Architecture:** Two new domains — `src/core/consumption` (proofs, EIP-712 payloads, transaction/fulfillment lifecycle) and `src/core/punch` (balance projection, campaigns, coffee crawls, dashboard) — each split into `domain` (pure), `server` (Elysia routes, services, Drizzle repositories, `ConsumerChainPort` + `PostgresMockConsumerChain`), and `client` (Eden hooks, UI), mirroring `src/core/cafe`. All cross-record mutations (emit PUNCH, burn PUNCH, unlock/redeem a voucher) run inside a single `db.transaction`, guarded by unique idempotency keys, so the mock adapter is swappable for a future `ViemConsumerChain` without touching services, hooks, or components.

**Tech Stack:** Next 16 App Router, React 19, Elysia + `@elysiajs/eden`, Drizzle ORM (Postgres, `node-postgres`), Zod, viem (`signTypedData`/EIP-712, `arbitrumSepolia`), TanStack Query, Vitest, Biome (4-space indent).

## Global Constraints

- One valid paid purchase emits exactly one PUNCH; every redemption burns exactly 12 PUNCH; PUNCH is non-transferable, non-withdrawable, never shown as a fiat value, never accepted as a free-form quantity.
- Home meter shows `min(balance, 12) / 12`; at ≥12 it shows `12 / 12` and "Recompensa disponible."
- A confirmed redemption atomically burns 12 PUNCH and records the modeled payout; a rejected redemption changes neither PUNCH nor voucher state.
- PostgreSQL is a projection, never command authority, except inside `PostgresMockConsumerChain`, which is the only code allowed to treat these records as authoritative. Application services, hooks, and components depend only on `ConsumerChainPort`.
- Demo EIP-712 domain is `name: "PunchConsumption"`, `version: "1"`, `chainId: 421614`, `verifyingContract: DEMO_CONSUMPTION_VERIFIER_ADDRESS`, where `DEMO_CONSUMPTION_VERIFIER_ADDRESS = "0x00000000000000000000000000000000000000FA"` lives only in `src/core/consumption/server/demo-chain-context.ts`. Never use `addresses.arbitrumSepolia.consumptionLog` while it is `ZERO_ADDRESS`, and never present the demo address as deployed.
- Barista QR is a signed purchase **draft** because the consumer is not known yet. On consumer confirmation, the server binds `user` to the consumer custodial address and has both the issuing café account and consumer account sign the same final EIP-712 `PurchaseProof` message. Never substitute `signMessage`; both final signatures use `signTypedData`.
- Mock submissions must visibly traverse `pending` before `confirmed`; terminal status is materialized idempotently on a later status poll. `failed` maps to “Reintento disponible”; `rejected` always carries an actionable reason.
- All consumer-facing copy is Spanish; UI never shows wallet/address/gas/seed/signature-byte language.
- Consumer UI reuses root `tokens.css` and landing typography/color/texture conventions. Do not introduce a generic fintech palette or a second token set.
- Service worker caches shell/static assets only. Authenticated dashboard/history snapshots are stored under user-scoped keys and cleared on logout; never put authenticated API responses in a shared Cache Storage entry.
- Follow the established `domain` / `server` / `client` split used by `src/core/cafe`; new integration points outside the two new domains are limited to Drizzle schema exports/migrations, Elysia router registration, the authenticated nav/redirect, and the existing café panel routes.
- TDD: write the failing test first for every pure function, service, stateful adapter behavior, and user-critical UI helper. Biome formatting is 4-space indent, run `pnpm check:fix` before each commit if unsure. Run `pnpm test`, `pnpm typecheck`, `pnpm biome check src`, `pnpm build` before the final commit.
- No contract files, no real viem adapter/relayer/indexer, no push notifications, no offline mutation queue, no PIN/biometrics, no maps/routing.

---

## File Map

```
src/core/consumption/
  domain/
    schemas.ts            # zod: proof payload, create-proof input, confirm input, redemption-request input
    types.ts               # z.infer types
    eip712.ts               # PURCHASE_PROOF_TYPES, purchaseProofDomain(), isProofExpired()
    nonce.ts                # toNonceHex(), generateNonce()
    transitions.ts          # canTransitionTransaction, canTransitionFulfillment
    __tests__/schemas.test.ts, eip712.test.ts, nonce.test.ts, transitions.test.ts
  server/
    repository/
      proofs.ts             # createProof, findProofById, findProofByNonceOrReceipt, bindProofSignatures
      transactions.ts        # createTransaction, findTransactionByIdempotencyKey, findTransactionByProofId, findTransactionByRedemptionRequestId, updateTransactionStatus
      redemption-requests.ts # createRedemptionRequest, findRedemptionRequestById, decideRedemptionRequest, listPendingRequestsForCafe
      utils.ts               # row → wire-type mappers
    chain-port.ts            # ConsumerChainPort interface + shared submission/status types
    demo-chain-context.ts    # named demo-only EIP-712 domain; never production address map
    postgres-mock-chain.ts   # PostgresMockConsumerChain, pending→terminal materialization
    services/
      create-purchase-proof-service.ts
      confirm-purchase-service.ts
      request-punch-redemption-service.ts
      decide-punch-redemption-service.ts
      request-voucher-redemption-service.ts
      decide-voucher-redemption-service.ts
      list-history-service.ts
      __tests__/*.test.ts
    api/
      router.ts
      routes/
        create-purchase-proof.route.ts
        get-purchase-proof.route.ts
        confirm-purchase.route.ts
        get-transaction.route.ts
        request-punch-redemption.route.ts
        decide-punch-redemption.route.ts
        request-voucher-redemption.route.ts
        decide-voucher-redemption.route.ts
        list-cafe-redemption-inbox.route.ts
        list-history.route.ts
  client/
    hooks.ts
    ui/
      transaction-status.tsx
      __tests__/transaction-status.test.ts

src/core/punch/
  domain/
    schemas.ts               # dashboard, campaign, voucher, crawl wire schemas
    types.ts
    progress.ts               # PUNCH_REDEMPTION_COST, progressFraction, canRedeem, balanceAfterRedemption
    campaign.ts                # isEligibleForAcquisitionCampaign
    crawl.ts                   # advanceCrawl
    __tests__/progress.test.ts, campaign.test.ts, crawl.test.ts
  server/
    repository/
      balance.ts               # getBalance, incrementBalance, decrementBalance
      campaigns.ts              # findActiveCampaignForCafe, hasPriorPaidPurchase, unlockCampaignVoucher, findVoucherUnlock
      crawls.ts                 # findActiveCrawlForCafe, getCrawlSteps, getOrCreateCrawlProgress, advanceCrawlProgress, unlockCrawlVoucher
      vouchers.ts                # findVoucherById, markVoucherRedeemed, listConsumerVouchers, expireStaleVouchers
    services/
      get-dashboard-service.ts
      list-campaigns-service.ts
      list-crawls-service.ts
      __tests__/*.test.ts
    api/
      router.ts
      routes/
        get-dashboard.route.ts
        list-campaigns.route.ts
        get-campaign.route.ts
        list-crawls.route.ts
        get-crawl.route.ts
        list-vouchers.route.ts
  client/
    hooks.ts
    ui/
      punch-meter.tsx
      voucher-card.tsx
      __tests__/punch-meter.test.ts

src/server/drizzle/schemas/
  consumption-schema.ts        # new
  punch-schema.ts               # new
  index.ts                      # modify: export both
src/server/drizzle/db.ts        # modify: export DbClient type

src/app/(app)/
  layout.tsx                    # modify: bottom nav shell, redirect target
  home/page.tsx
  discover/page.tsx             # modify: district grouping, geolocation
  discover/[cafeId]/page.tsx    # modify: separate emission/reward/voucher sections
  scan/page.tsx
  purchase/[proofId]/page.tsx
  history/page.tsx
  redeem/[productId]/page.tsx
  campaigns/page.tsx
  campaigns/[campaignId]/page.tsx
  crawls/page.tsx
  crawls/[crawlId]/page.tsx
  more/page.tsx
  cafe/[cafeId]/terminal/page.tsx
  cafe/[cafeId]/redemptions/page.tsx

src/frontend/providers/providers.tsx   # modify: redirectTo "/home"
src/frontend/components/nav/bottom-nav.tsx  # new
src/frontend/components/consumer/consumer-shell.css  # landing-aligned editorial product styles
src/frontend/components/consumer/offline-snapshot.ts  # user-scoped read snapshot helpers
src/frontend/components/consumer/__tests__/offline-snapshot.test.ts

public/manifest.webmanifest, public/sw.js, public/icons/punch-192.svg, public/icons/punch-512.svg
src/app/pwa-register.tsx        # new

src/server/router.ts             # modify: register consumption/punch routers
scripts/seed.ts                  # modify: deterministic demo state
```

---

### Task 1: Consumption domain — schemas, EIP-712 payload, nonce, transitions

**Files:**
- Create: `src/core/consumption/domain/schemas.ts`
- Create: `src/core/consumption/domain/types.ts`
- Create: `src/core/consumption/domain/eip712.ts`
- Create: `src/core/consumption/domain/nonce.ts`
- Create: `src/core/consumption/domain/transitions.ts`
- Test: `src/core/consumption/domain/__tests__/schemas.test.ts`
- Test: `src/core/consumption/domain/__tests__/eip712.test.ts`
- Test: `src/core/consumption/domain/__tests__/nonce.test.ts`
- Test: `src/core/consumption/domain/__tests__/transitions.test.ts`

**Interfaces:**
- Produces: `PURCHASE_PROOF_TYPES`, `purchaseProofDomain({ verifyingContract, chainId })`, `isProofExpired(expiry: bigint, nowSeconds: number)`, `toNonceHex(bytes: Uint8Array)`, `generateNonce()`, `canTransitionTransaction(from, to)`, `canTransitionFulfillment(from, to)`, `createPurchaseProofSchema`, `confirmPurchaseSchema`, `purchaseProofSchema`, `consumerTransactionStatusSchema`, `PURCHASE_PROOF_TTL_SECONDS`.

- [ ] **Step 1: Write failing tests for EIP-712 helpers**

```typescript
// src/core/consumption/domain/__tests__/eip712.test.ts
import { describe, expect, it } from "vitest";
import {
    isProofExpired,
    PURCHASE_PROOF_TYPES,
    purchaseProofDomain,
} from "../eip712";

describe("purchaseProofDomain", () => {
    it("builds the demo EIP-712 domain", () => {
        const domain = purchaseProofDomain({
            verifyingContract: "0x000000000000000000000000000000000000fA",
            chainId: 421614,
        });
        expect(domain).toEqual({
            name: "PunchConsumption",
            version: "1",
            chainId: 421614,
            verifyingContract: "0x000000000000000000000000000000000000fA",
        });
    });
});

describe("PURCHASE_PROOF_TYPES", () => {
    it("declares every parent-spec signed field", () => {
        expect(PURCHASE_PROOF_TYPES.PurchaseProof.map((f) => f.name)).toEqual([
            "cafeId",
            "user",
            "productId",
            "amountCentimos",
            "receiptHash",
            "nonce",
            "expiry",
            "chainId",
            "verifyingContract",
        ]);
    });
});

describe("isProofExpired", () => {
    it("is expired once now reaches expiry", () => {
        expect(isProofExpired(1000n, 1000)).toBe(true);
    });
    it("is not expired before expiry", () => {
        expect(isProofExpired(1000n, 999)).toBe(false);
    });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/core/consumption/domain/__tests__/eip712.test.ts`
Expected: FAIL — `Cannot find module '../eip712'`

- [ ] **Step 3: Implement `eip712.ts`**

```typescript
// src/core/consumption/domain/eip712.ts
import type { TypedDataDomain } from "viem";

export const PURCHASE_PROOF_TYPES = {
    PurchaseProof: [
        { name: "cafeId", type: "string" },
        { name: "user", type: "address" },
        { name: "productId", type: "string" },
        { name: "amountCentimos", type: "uint256" },
        { name: "receiptHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
        { name: "expiry", type: "uint256" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
    ],
} as const;

export type PurchaseProofMessage = {
    cafeId: string;
    user: `0x${string}`;
    productId: string;
    amountCentimos: bigint;
    receiptHash: `0x${string}`;
    nonce: `0x${string}`;
    expiry: bigint;
    chainId: bigint;
    verifyingContract: `0x${string}`;
};

/** Demo verifying-domain context. Production must supply the deployed contract. */
export function purchaseProofDomain(params: {
    verifyingContract: `0x${string}`;
    chainId: number;
}): TypedDataDomain {
    return {
        name: "PunchConsumption",
        version: "1",
        chainId: params.chainId,
        verifyingContract: params.verifyingContract,
    };
}

/** Server clock authority — never trust the client clock for expiry. */
export function isProofExpired(expiry: bigint, nowSeconds: number): boolean {
    return BigInt(nowSeconds) >= expiry;
}

export const PURCHASE_PROOF_TTL_SECONDS = 120;
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm vitest run src/core/consumption/domain/__tests__/eip712.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write failing nonce tests**

```typescript
// src/core/consumption/domain/__tests__/nonce.test.ts
import { describe, expect, it } from "vitest";
import { generateNonce, toNonceHex } from "../nonce";

describe("toNonceHex", () => {
    it("hex-encodes 32 bytes with 0x prefix", () => {
        const bytes = new Uint8Array(32).fill(1);
        expect(toNonceHex(bytes)).toBe(`0x${"01".repeat(32)}`);
    });
    it("rejects a non-32-byte input", () => {
        expect(() => toNonceHex(new Uint8Array(31))).toThrow(
            "nonce must be 32 bytes",
        );
    });
});

describe("generateNonce", () => {
    it("produces a well-formed bytes32 hex nonce", () => {
        expect(generateNonce()).toMatch(/^0x[0-9a-f]{64}$/);
    });
    it("is unpredictable across calls", () => {
        expect(generateNonce()).not.toBe(generateNonce());
    });
});
```

- [ ] **Step 6: Run and confirm failure, then implement**

Run: `pnpm vitest run src/core/consumption/domain/__tests__/nonce.test.ts` → FAIL (module not found)

```typescript
// src/core/consumption/domain/nonce.ts
export function toNonceHex(bytes: Uint8Array): `0x${string}` {
    if (bytes.length !== 32) throw new Error("nonce must be 32 bytes");
    return `0x${Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}` as `0x${string}`;
}

export function generateNonce(): `0x${string}` {
    return toNonceHex(crypto.getRandomValues(new Uint8Array(32)));
}
```

Run: `pnpm vitest run src/core/consumption/domain/__tests__/nonce.test.ts` → PASS (4 tests)

- [ ] **Step 7: Write failing transition tests**

```typescript
// src/core/consumption/domain/__tests__/transitions.test.ts
import { describe, expect, it } from "vitest";
import { canTransitionFulfillment, canTransitionTransaction } from "../transitions";

describe("canTransitionTransaction", () => {
    it("allows pending to confirmed, rejected, or failed", () => {
        expect(canTransitionTransaction("pending", "confirmed")).toBe(true);
        expect(canTransitionTransaction("pending", "rejected")).toBe(true);
        expect(canTransitionTransaction("pending", "failed")).toBe(true);
    });
    it("allows a retry from failed back to pending", () => {
        expect(canTransitionTransaction("failed", "pending")).toBe(true);
    });
    it("forbids leaving a terminal confirmed state", () => {
        expect(canTransitionTransaction("confirmed", "pending")).toBe(false);
        expect(canTransitionTransaction("confirmed", "rejected")).toBe(false);
    });
    it("forbids leaving a terminal rejected state", () => {
        expect(canTransitionTransaction("rejected", "pending")).toBe(false);
    });
});

describe("canTransitionFulfillment", () => {
    it("allows pending to approved or rejected only", () => {
        expect(canTransitionFulfillment("pending", "approved")).toBe(true);
        expect(canTransitionFulfillment("pending", "rejected")).toBe(true);
    });
    it("forbids deciding an already-decided request", () => {
        expect(canTransitionFulfillment("approved", "rejected")).toBe(false);
        expect(canTransitionFulfillment("rejected", "approved")).toBe(false);
    });
});
```

- [ ] **Step 8: Run, confirm failure, implement**

```typescript
// src/core/consumption/domain/transitions.ts
export type ConsumerTransactionStatus =
    | "pending"
    | "confirmed"
    | "rejected"
    | "failed";

const ALLOWED_TX: Record<ConsumerTransactionStatus, ConsumerTransactionStatus[]> = {
    pending: ["confirmed", "rejected", "failed"],
    confirmed: [],
    rejected: [],
    failed: ["pending"],
};

export function canTransitionTransaction(
    from: ConsumerTransactionStatus,
    to: ConsumerTransactionStatus,
): boolean {
    return ALLOWED_TX[from].includes(to);
}

export type FulfillmentRequestStatus = "pending" | "approved" | "rejected";

const ALLOWED_FULFILLMENT: Record<
    FulfillmentRequestStatus,
    FulfillmentRequestStatus[]
> = {
    pending: ["approved", "rejected"],
    approved: [],
    rejected: [],
};

export function canTransitionFulfillment(
    from: FulfillmentRequestStatus,
    to: FulfillmentRequestStatus,
): boolean {
    return ALLOWED_FULFILLMENT[from].includes(to);
}
```

Run: `pnpm vitest run src/core/consumption/domain/__tests__/transitions.test.ts` → PASS (6 tests)

- [ ] **Step 9: Write failing schema tests**

```typescript
// src/core/consumption/domain/__tests__/schemas.test.ts
import { describe, expect, it } from "vitest";
import {
    confirmPurchaseSchema,
    createPurchaseProofSchema,
    purchaseProofSchema,
} from "../schemas";

describe("createPurchaseProofSchema", () => {
    it("requires a productId and a receiptHash", () => {
        expect(() =>
            createPurchaseProofSchema.parse({
                productId: "p1",
                receiptHash: `0x${"ab".repeat(32)}`,
            }),
        ).not.toThrow();
    });
    it("rejects a malformed receiptHash", () => {
        expect(() =>
            createPurchaseProofSchema.parse({
                productId: "p1",
                receiptHash: "not-a-hash",
            }),
        ).toThrow();
    });
});

describe("confirmPurchaseSchema", () => {
    it("requires only a proofId", () => {
        expect(() =>
            confirmPurchaseSchema.parse({ proofId: "proof-1" }),
        ).not.toThrow();
    });
});

describe("purchaseProofSchema", () => {
    it("parses the public wire shape", () => {
        expect(() =>
            purchaseProofSchema.parse({
                id: "proof-1",
                cafeId: "cafe-1",
                productId: "product-1",
                amountCentimos: 800,
                expiresAt: new Date().toISOString(),
                status: "issued",
                createdAt: new Date().toISOString(),
            }),
        ).not.toThrow();
    });
});
```

- [ ] **Step 10: Run, confirm failure, implement schemas + types**

```typescript
// src/core/consumption/domain/schemas.ts
import { z } from "zod";

const bytes32Hex = z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "Hash inválido (bytes32)");

export const createPurchaseProofSchema = z.object({
    productId: z.string().min(1),
    receiptHash: bytes32Hex,
});

export const confirmPurchaseSchema = z.object({
    proofId: z.string().min(1),
});

export const consumerTransactionStatusSchema = z.enum([
    "pending",
    "confirmed",
    "rejected",
    "failed",
]);

export const consumptionOperationSchema = z.enum([
    "emission",
    "punch_redemption",
    "voucher_redemption",
]);

export const fulfillmentRequestStatusSchema = z.enum([
    "pending",
    "approved",
    "rejected",
]);

export const redemptionRequestKindSchema = z.enum(["punch_reward", "voucher"]);

export const purchaseProofStatusSchema = z.enum(["issued", "confirmed"]);

export const purchaseProofSchema = z.object({
    id: z.string(),
    cafeId: z.string(),
    productId: z.string(),
    amountCentimos: z.number().int().positive(),
    expiresAt: z.string(),
    status: purchaseProofStatusSchema,
    createdAt: z.string(),
});

export const consumerTransactionSchema = z.object({
    id: z.string(),
    operation: consumptionOperationSchema,
    cafeId: z.string(),
    status: consumerTransactionStatusSchema,
    rejectionReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const requestPunchRedemptionSchema = z.object({
    productId: z.string().min(1),
});

export const requestVoucherRedemptionSchema = z.object({
    voucherId: z.string().min(1),
});

export const decideRedemptionRequestSchema = z
    .object({
        decision: z.enum(["approved", "rejected"]),
        rejectionReason: z.string().trim().max(500).optional(),
    })
    .refine((r) => r.decision !== "rejected" || !!r.rejectionReason, {
        message: "Un rechazo debe incluir una razón accionable",
        path: ["rejectionReason"],
    });

export const redemptionRequestSchema = z.object({
    id: z.string(),
    kind: redemptionRequestKindSchema,
    cafeId: z.string(),
    productId: z.string().nullable(),
    voucherId: z.string().nullable(),
    status: fulfillmentRequestStatusSchema,
    rejectionReason: z.string().nullable(),
    createdAt: z.string(),
});
```

```typescript
// src/core/consumption/domain/types.ts
import type { z } from "zod";
import type {
    confirmPurchaseSchema,
    consumerTransactionSchema,
    consumerTransactionStatusSchema,
    consumptionOperationSchema,
    createPurchaseProofSchema,
    decideRedemptionRequestSchema,
    fulfillmentRequestStatusSchema,
    purchaseProofSchema,
    purchaseProofStatusSchema,
    redemptionRequestKindSchema,
    redemptionRequestSchema,
    requestPunchRedemptionSchema,
    requestVoucherRedemptionSchema,
} from "./schemas";

export type CreatePurchaseProof = z.infer<typeof createPurchaseProofSchema>;
export type ConfirmPurchase = z.infer<typeof confirmPurchaseSchema>;
export type PurchaseProofStatus = z.infer<typeof purchaseProofStatusSchema>;
export type PurchaseProof = z.infer<typeof purchaseProofSchema>;
export type ConsumptionOperation = z.infer<typeof consumptionOperationSchema>;
export type ConsumerTransactionStatus = z.infer<
    typeof consumerTransactionStatusSchema
>;
export type ConsumerTransaction = z.infer<typeof consumerTransactionSchema>;
export type FulfillmentRequestStatus = z.infer<
    typeof fulfillmentRequestStatusSchema
>;
export type RedemptionRequestKind = z.infer<typeof redemptionRequestKindSchema>;
export type RequestPunchRedemption = z.infer<typeof requestPunchRedemptionSchema>;
export type RequestVoucherRedemption = z.infer<
    typeof requestVoucherRedemptionSchema
>;
export type DecideRedemptionRequest = z.infer<
    typeof decideRedemptionRequestSchema
>;
export type RedemptionRequest = z.infer<typeof redemptionRequestSchema>;
```

Run: `pnpm vitest run src/core/consumption/domain/__tests__/schemas.test.ts` → PASS (4 tests)

- [ ] **Step 11: Typecheck and lint**

Run: `pnpm typecheck && pnpm biome check src/core/consumption`
Expected: no errors

- [ ] **Step 12: Commit**

```bash
git add src/core/consumption/domain
git commit -m "feat(consumption): add EIP-712 payload, nonce, and lifecycle domain logic"
```

---

### Task 2: Punch domain — progress, campaign eligibility, crawl progression

**Files:**
- Create: `src/core/punch/domain/progress.ts`
- Create: `src/core/punch/domain/campaign.ts`
- Create: `src/core/punch/domain/crawl.ts`
- Create: `src/core/punch/domain/schemas.ts`
- Create: `src/core/punch/domain/types.ts`
- Test: `src/core/punch/domain/__tests__/progress.test.ts`
- Test: `src/core/punch/domain/__tests__/campaign.test.ts`
- Test: `src/core/punch/domain/__tests__/crawl.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain layer, no dependency on Task 1).
- Produces: `PUNCH_REDEMPTION_COST`, `progressFraction(balance)`, `canRedeem(balance)`, `balanceAfterRedemption(balance)`, `isEligibleForAcquisitionCampaign(input)`, `advanceCrawl(input)` with `CrawlStepDefinition`, `CrawlProgressInput`, `CrawlAdvanceResult` types, `dashboardSchema`, `campaignSchema`, `consumerVoucherSchema`, `coffeeCrawlSchema`.

- [ ] **Step 1: Write failing progress tests**

```typescript
// src/core/punch/domain/__tests__/progress.test.ts
import { describe, expect, it } from "vitest";
import {
    balanceAfterRedemption,
    canRedeem,
    progressFraction,
    PUNCH_REDEMPTION_COST,
} from "../progress";

describe("PUNCH_REDEMPTION_COST", () => {
    it("is fixed at 12", () => {
        expect(PUNCH_REDEMPTION_COST).toBe(12);
    });
});

describe("progressFraction", () => {
    it("returns balance/12 below the cap", () => {
        expect(progressFraction(5)).toEqual({ numerator: 5, denominator: 12 });
    });
    it("caps the numerator at 12 once eligible", () => {
        expect(progressFraction(15)).toEqual({ numerator: 12, denominator: 12 });
    });
    it("rejects a non-integer balance", () => {
        expect(() => progressFraction(1.5)).toThrow("Invalid PUNCH balance");
    });
    it("rejects a negative balance", () => {
        expect(() => progressFraction(-1)).toThrow("Invalid PUNCH balance");
    });
});

describe("canRedeem / balanceAfterRedemption", () => {
    it("cannot redeem below 12", () => {
        expect(canRedeem(11)).toBe(false);
    });
    it("can redeem at exactly 12", () => {
        expect(canRedeem(12)).toBe(true);
    });
    it("subtracts exactly 12 on redemption", () => {
        expect(balanceAfterRedemption(14)).toBe(2);
    });
    it("throws when redeeming below 12", () => {
        expect(() => balanceAfterRedemption(11)).toThrow(
            "Insufficient PUNCH balance for redemption",
        );
    });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/core/punch/domain/__tests__/progress.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement `progress.ts`**

```typescript
// src/core/punch/domain/progress.ts
export const PUNCH_REDEMPTION_COST = 12;

export function progressFraction(balance: number): {
    numerator: number;
    denominator: 12;
} {
    if (!Number.isInteger(balance) || balance < 0) {
        throw new Error(`Invalid PUNCH balance: ${balance}`);
    }
    return {
        numerator: Math.min(balance, PUNCH_REDEMPTION_COST),
        denominator: PUNCH_REDEMPTION_COST,
    };
}

export function canRedeem(balance: number): boolean {
    return balance >= PUNCH_REDEMPTION_COST;
}

export function balanceAfterRedemption(balance: number): number {
    if (!canRedeem(balance)) {
        throw new Error("Insufficient PUNCH balance for redemption");
    }
    return balance - PUNCH_REDEMPTION_COST;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm vitest run src/core/punch/domain/__tests__/progress.test.ts` → PASS (8 tests)

- [ ] **Step 5: Write failing campaign tests**

```typescript
// src/core/punch/domain/__tests__/campaign.test.ts
import { describe, expect, it } from "vitest";
import { isEligibleForAcquisitionCampaign } from "../campaign";

const windowStart = new Date("2026-08-01T00:00:00Z");
const windowEnd = new Date("2026-08-31T23:59:59Z");

describe("isEligibleForAcquisitionCampaign", () => {
    it("is eligible for a first purchase at the target café inside the window", () => {
        expect(
            isEligibleForAcquisitionCampaign({
                campaignCafeId: "cafe-1",
                purchaseCafeId: "cafe-1",
                hadPriorPaidPurchaseAtCafe: false,
                purchaseAt: new Date("2026-08-08T12:00:00Z"),
                campaignWindowStart: windowStart,
                campaignWindowEnd: windowEnd,
            }),
        ).toBe(true);
    });
    it("is ineligible with a prior paid purchase at that café", () => {
        expect(
            isEligibleForAcquisitionCampaign({
                campaignCafeId: "cafe-1",
                purchaseCafeId: "cafe-1",
                hadPriorPaidPurchaseAtCafe: true,
                purchaseAt: new Date("2026-08-08T12:00:00Z"),
                campaignWindowStart: windowStart,
                campaignWindowEnd: windowEnd,
            }),
        ).toBe(false);
    });
    it("is ineligible at a different café", () => {
        expect(
            isEligibleForAcquisitionCampaign({
                campaignCafeId: "cafe-1",
                purchaseCafeId: "cafe-2",
                hadPriorPaidPurchaseAtCafe: false,
                purchaseAt: new Date("2026-08-08T12:00:00Z"),
                campaignWindowStart: windowStart,
                campaignWindowEnd: windowEnd,
            }),
        ).toBe(false);
    });
    it("is ineligible outside the campaign window", () => {
        expect(
            isEligibleForAcquisitionCampaign({
                campaignCafeId: "cafe-1",
                purchaseCafeId: "cafe-1",
                hadPriorPaidPurchaseAtCafe: false,
                purchaseAt: new Date("2026-09-01T00:00:01Z"),
                campaignWindowStart: windowStart,
                campaignWindowEnd: windowEnd,
            }),
        ).toBe(false);
    });
});
```

- [ ] **Step 6: Run, confirm failure, implement**

```typescript
// src/core/punch/domain/campaign.ts
export type CampaignEligibilityInput = {
    campaignCafeId: string;
    purchaseCafeId: string;
    hadPriorPaidPurchaseAtCafe: boolean;
    purchaseAt: Date;
    campaignWindowStart: Date;
    campaignWindowEnd: Date;
};

export function isEligibleForAcquisitionCampaign(
    input: CampaignEligibilityInput,
): boolean {
    return (
        input.purchaseCafeId === input.campaignCafeId &&
        !input.hadPriorPaidPurchaseAtCafe &&
        input.purchaseAt >= input.campaignWindowStart &&
        input.purchaseAt <= input.campaignWindowEnd
    );
}
```

Run: `pnpm vitest run src/core/punch/domain/__tests__/campaign.test.ts` → PASS (4 tests)

- [ ] **Step 7: Write failing crawl tests**

```typescript
// src/core/punch/domain/__tests__/crawl.test.ts
import { describe, expect, it } from "vitest";
import { advanceCrawl } from "../crawl";

const steps = [
    { stepIndex: 0, cafeId: "cafe-a" },
    { stepIndex: 1, cafeId: "cafe-b" },
    { stepIndex: 2, cafeId: "cafe-c" },
];
const now = new Date("2026-08-08T12:00:00Z");
const crawlExpiresAt = new Date("2026-12-31T23:59:59Z");

describe("advanceCrawl", () => {
    it("advances on the correct next step", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: ["cafe-a", "cafe-b"],
                purchaseCafeId: "cafe-c",
                now,
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: true, nextStepIndex: 3, crawlCompleted: true });
    });
    it("does not complete before the final step", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: [],
                purchaseCafeId: "cafe-a",
                now,
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: true, nextStepIndex: 1, crawlCompleted: false });
    });
    it("rejects a purchase at the wrong next café", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: ["cafe-a"],
                purchaseCafeId: "cafe-c",
                now,
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: false, reason: "not_next_step" });
    });
    it("rejects an expired crawl", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: [],
                purchaseCafeId: "cafe-a",
                now: new Date("2027-01-01T00:00:00Z"),
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: false, reason: "expired" });
    });
    it("rejects an already-completed crawl", () => {
        expect(
            advanceCrawl({
                steps,
                completedCafeIds: ["cafe-a", "cafe-b", "cafe-c"],
                purchaseCafeId: "cafe-a",
                now,
                crawlExpiresAt,
            }),
        ).toEqual({ advanced: false, reason: "already_completed" });
    });
});
```

- [ ] **Step 8: Run, confirm failure, implement**

```typescript
// src/core/punch/domain/crawl.ts
export type CrawlStepDefinition = { stepIndex: number; cafeId: string };

export type CrawlProgressInput = {
    steps: CrawlStepDefinition[];
    completedCafeIds: string[];
    purchaseCafeId: string;
    now: Date;
    crawlExpiresAt: Date;
};

export type CrawlAdvanceResult =
    | { advanced: false; reason: "expired" | "not_next_step" | "already_completed" }
    | { advanced: true; nextStepIndex: number; crawlCompleted: boolean };

/** Ordered A→B→C progression: only the next distinct café's purchase advances the crawl. */
export function advanceCrawl(input: CrawlProgressInput): CrawlAdvanceResult {
    if (input.now > input.crawlExpiresAt) return { advanced: false, reason: "expired" };
    if (input.completedCafeIds.length >= input.steps.length) {
        return { advanced: false, reason: "already_completed" };
    }
    const nextStep = input.steps[input.completedCafeIds.length];
    if (!nextStep || nextStep.cafeId !== input.purchaseCafeId) {
        return { advanced: false, reason: "not_next_step" };
    }
    const nextStepIndex = input.completedCafeIds.length + 1;
    return {
        advanced: true,
        nextStepIndex,
        crawlCompleted: nextStepIndex === input.steps.length,
    };
}
```

Run: `pnpm vitest run src/core/punch/domain/__tests__/crawl.test.ts` → PASS (5 tests)

- [ ] **Step 9: Add wire schemas and types (no new tests — mirrors Task 1 Step 10 pattern, verified by typecheck)**

```typescript
// src/core/punch/domain/schemas.ts
import { z } from "zod";

export const campaignStatusSchema = z.enum(["available", "redeemed", "expired"]);

export const dashboardSchema = z.object({
    balance: z.number().int().nonnegative(),
    progress: z.object({
        numerator: z.number().int(),
        denominator: z.literal(12),
    }),
    activeCampaign: z
        .object({ id: z.string(), name: z.string(), cafeId: z.string() })
        .nullable(),
    activeCrawl: z
        .object({
            id: z.string(),
            name: z.string(),
            completedSteps: z.number().int(),
            totalSteps: z.number().int(),
        })
        .nullable(),
});

export const campaignSchema = z.object({
    id: z.string(),
    kind: z.literal("verified_acquisition"),
    cafeId: z.string(),
    name: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    active: z.boolean(),
});

export const consumerVoucherSchema = z.object({
    id: z.string(),
    source: z.enum(["campaign", "crawl"]),
    cafeId: z.string().nullable(),
    status: campaignStatusSchema,
    expiresAt: z.string(),
    redeemedAt: z.string().nullable(),
});

export const coffeeCrawlStepSchema = z.object({
    stepIndex: z.number().int(),
    cafeId: z.string(),
});

export const coffeeCrawlSchema = z.object({
    id: z.string(),
    name: z.string(),
    expiresAt: z.string(),
    steps: z.array(coffeeCrawlStepSchema),
});
```

```typescript
// src/core/punch/domain/types.ts
import type { z } from "zod";
import type {
    campaignSchema,
    campaignStatusSchema,
    coffeeCrawlSchema,
    coffeeCrawlStepSchema,
    consumerVoucherSchema,
    dashboardSchema,
} from "./schemas";

export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Campaign = z.infer<typeof campaignSchema>;
export type ConsumerVoucher = z.infer<typeof consumerVoucherSchema>;
export type CoffeeCrawlStep = z.infer<typeof coffeeCrawlStepSchema>;
export type CoffeeCrawl = z.infer<typeof coffeeCrawlSchema>;
```

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck && pnpm biome check src/core/punch`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add src/core/punch/domain
git commit -m "feat(punch): add balance progress, campaign eligibility, and crawl domain logic"
```

---

### Task 3: Drizzle schema for consumption and punch domains

**Files:**
- Create: `src/server/drizzle/schemas/consumption-schema.ts`
- Create: `src/server/drizzle/schemas/punch-schema.ts`
- Modify: `src/server/drizzle/schemas/index.ts`
- Modify: `src/server/drizzle/db.ts` (export `DbClient` type)

**Interfaces:**
- Produces (row types used by every later repository task): `ConsumptionProofRow`, `NewConsumptionProofRow`, `ConsumerTransactionRow`, `NewConsumerTransactionRow`, `RedemptionRequestRow`, `NewRedemptionRequestRow`, `PunchBalanceProjectionRow`, `CampaignRow`, `ConsumerVoucherRow`, `NewConsumerVoucherRow`, `CoffeeCrawlRow`, `CoffeeCrawlStepRow`, `ConsumerCrawlProgressRow`, `NewConsumerCrawlProgressRow`, `DbClient`.

There is no schema test convention in this repo (`src/core/cafe/domain/schemas.ts` has no drizzle test); this task is verified with `db:generate`, `typecheck`, and `build`.

- [ ] **Step 1: Write `consumption-schema.ts`**

```typescript
// src/server/drizzle/schemas/consumption-schema.ts
import { sql } from "drizzle-orm";
import {
    check,
    index,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { cafe, cafeProduct } from "./cafe-schema";
import { user } from "./auth-schema";

export const purchaseProofStatus = pgEnum("purchase_proof_status", [
    "issued",
    "confirmed",
]);

export const consumptionProof = pgTable(
    "consumption_proof",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "cascade" }),
        productId: text("product_id")
            .notNull()
            .references(() => cafeProduct.id, { onDelete: "cascade" }),
        issuedByUserId: text("issued_by_user_id")
            .notNull()
            .references(() => user.id),
        consumerUserId: text("consumer_user_id").references(() => user.id),
        amountCentimos: integer("amount_centimos").notNull(),
        receiptHash: text("receipt_hash").notNull(),
        nonce: text("nonce").notNull(),
        cafeSignature: text("cafe_signature").notNull(),
        consumerSignature: text("consumer_signature"),
        status: purchaseProofStatus("status").default("issued").notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("consumption_proof_nonce_uq").on(table.nonce),
        uniqueIndex("consumption_proof_receipt_hash_uq").on(table.receiptHash),
        index("consumption_proof_cafe_id_idx").on(table.cafeId),
        check(
            "consumption_proof_amount_positive",
            sql`${table.amountCentimos} > 0`,
        ),
    ],
);

export const consumptionOperation = pgEnum("consumption_operation", [
    "emission",
    "punch_redemption",
    "voucher_redemption",
]);
export const consumerTransactionStatus = pgEnum("consumer_transaction_status", [
    "pending",
    "confirmed",
    "rejected",
    "failed",
]);

export const consumerTransaction = pgTable(
    "consumer_transaction",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        operation: consumptionOperation("operation").notNull(),
        consumerUserId: text("consumer_user_id")
            .notNull()
            .references(() => user.id),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id),
        proofId: text("proof_id").references(() => consumptionProof.id),
        redemptionRequestId: text("redemption_request_id"),
        chainTxId: text("chain_tx_id").notNull(),
        status: consumerTransactionStatus("status").default("pending").notNull(),
        rejectionReason: text("rejection_reason"),
        idempotencyKey: text("idempotency_key").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("consumer_transaction_idempotency_uq").on(
            table.idempotencyKey,
        ),
        index("consumer_transaction_consumer_id_idx").on(table.consumerUserId),
        index("consumer_transaction_proof_id_idx").on(table.proofId),
    ],
);

export const redemptionRequestKind = pgEnum("redemption_request_kind", [
    "punch_reward",
    "voucher",
]);
export const redemptionRequestStatus = pgEnum("redemption_request_status", [
    "pending",
    "approved",
    "rejected",
]);

export const redemptionRequest = pgTable(
    "redemption_request",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        kind: redemptionRequestKind("kind").notNull(),
        consumerUserId: text("consumer_user_id")
            .notNull()
            .references(() => user.id),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id),
        productId: text("product_id").references(() => cafeProduct.id),
        voucherId: text("voucher_id"),
        status: redemptionRequestStatus("status").default("pending").notNull(),
        rejectionReason: text("rejection_reason"),
        decidedByUserId: text("decided_by_user_id").references(() => user.id),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("redemption_request_cafe_id_idx").on(table.cafeId),
        index("redemption_request_consumer_id_idx").on(table.consumerUserId),
    ],
);

export type ConsumptionProofRow = typeof consumptionProof.$inferSelect;
export type NewConsumptionProofRow = typeof consumptionProof.$inferInsert;
export type ConsumerTransactionRow = typeof consumerTransaction.$inferSelect;
export type NewConsumerTransactionRow = typeof consumerTransaction.$inferInsert;
export type RedemptionRequestRow = typeof redemptionRequest.$inferSelect;
export type NewRedemptionRequestRow = typeof redemptionRequest.$inferInsert;
```

- [ ] **Step 2: Write `punch-schema.ts`**

```typescript
// src/server/drizzle/schemas/punch-schema.ts
import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { cafe } from "./cafe-schema";
import { user } from "./auth-schema";

export const punchBalanceProjection = pgTable("punch_balance_projection", {
    userId: text("user_id")
        .primaryKey()
        .references(() => user.id, { onDelete: "cascade" }),
    balance: integer("balance").default(0).notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .$onUpdate(() => new Date())
        .notNull(),
});

export const campaignKind = pgEnum("campaign_kind", ["verified_acquisition"]);

export const campaign = pgTable("campaign", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    kind: campaignKind("kind").notNull(),
    cafeId: text("cafe_id")
        .notNull()
        .references(() => cafe.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    windowStart: timestamp("window_start").notNull(),
    windowEnd: timestamp("window_end").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const voucherSource = pgEnum("voucher_source", ["campaign", "crawl"]);
export const voucherStatus = pgEnum("voucher_status", [
    "available",
    "redeemed",
    "expired",
]);

export const consumerVoucher = pgTable(
    "consumer_voucher",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        source: voucherSource("source").notNull(),
        campaignId: text("campaign_id").references(() => campaign.id),
        crawlId: text("crawl_id"),
        consumerUserId: text("consumer_user_id")
            .notNull()
            .references(() => user.id),
        cafeId: text("cafe_id").references(() => cafe.id),
        status: voucherStatus("status").default("available").notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        redeemedAt: timestamp("redeemed_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("consumer_voucher_campaign_unlock_uq").on(
            table.campaignId,
            table.consumerUserId,
        ),
        uniqueIndex("consumer_voucher_crawl_unlock_uq").on(
            table.crawlId,
            table.consumerUserId,
        ),
    ],
);

export const coffeeCrawl = pgTable("coffee_crawl", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const coffeeCrawlStep = pgTable(
    "coffee_crawl_step",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        crawlId: text("crawl_id")
            .notNull()
            .references(() => coffeeCrawl.id, { onDelete: "cascade" }),
        stepIndex: integer("step_index").notNull(),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id),
    },
    (table) => [
        uniqueIndex("coffee_crawl_step_crawl_index_uq").on(
            table.crawlId,
            table.stepIndex,
        ),
    ],
);

export const crawlProgressStatus = pgEnum("crawl_progress_status", [
    "in_progress",
    "completed",
    "expired",
]);

export const consumerCrawlProgress = pgTable(
    "consumer_crawl_progress",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        crawlId: text("crawl_id")
            .notNull()
            .references(() => coffeeCrawl.id, { onDelete: "cascade" }),
        consumerUserId: text("consumer_user_id")
            .notNull()
            .references(() => user.id),
        completedCafeIds: text("completed_cafe_ids").array().default([]).notNull(),
        status: crawlProgressStatus("status").default("in_progress").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("consumer_crawl_progress_uq").on(
            table.crawlId,
            table.consumerUserId,
        ),
        check(
            "consumer_crawl_progress_balance_nonneg",
            sql`array_length(${table.completedCafeIds}, 1) is null or array_length(${table.completedCafeIds}, 1) >= 0`,
        ),
    ],
);

export type PunchBalanceProjectionRow = typeof punchBalanceProjection.$inferSelect;
export type CampaignRow = typeof campaign.$inferSelect;
export type ConsumerVoucherRow = typeof consumerVoucher.$inferSelect;
export type NewConsumerVoucherRow = typeof consumerVoucher.$inferInsert;
export type CoffeeCrawlRow = typeof coffeeCrawl.$inferSelect;
export type CoffeeCrawlStepRow = typeof coffeeCrawlStep.$inferSelect;
export type ConsumerCrawlProgressRow = typeof consumerCrawlProgress.$inferSelect;
export type NewConsumerCrawlProgressRow = typeof consumerCrawlProgress.$inferInsert;
```

- [ ] **Step 3: Export both schemas from the schema index**

```typescript
// src/server/drizzle/schemas/index.ts
export * from "./auth-schema";
export * from "./cafe-schema";
export * from "./consumption-schema";
export * from "./project-schema";
export * from "./punch-schema";
```

- [ ] **Step 4: Export the `DbClient` type**

```typescript
// src/server/drizzle/db.ts (append at bottom, keep existing db export)
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = typeof db | DbTransaction;
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file under `drizzle/` (or configured migrations dir) with `CREATE TABLE consumption_proof`, `consumer_transaction`, `redemption_request`, `punch_balance_projection`, `campaign`, `consumer_voucher`, `coffee_crawl`, `coffee_crawl_step`, `consumer_crawl_progress`, plus their enums/indexes.

- [ ] **Step 6: Typecheck and build**

Run: `pnpm typecheck`
Expected: no errors — confirms every row/insert type compiles.

- [ ] **Step 7: Commit**

```bash
git add src/server/drizzle drizzle
git commit -m "feat(drizzle): add consumption and punch domain tables and migration"
```

---

### Task 4: `ConsumerChainPort`, repositories, and `PostgresMockConsumerChain` read paths

**Files:**
- Create: `src/core/consumption/server/chain-port.ts`
- Create: `src/core/consumption/server/repository/proofs.ts`
- Create: `src/core/consumption/server/repository/transactions.ts`
- Create: `src/core/consumption/server/repository/redemption-requests.ts`
- Create: `src/core/consumption/server/repository/utils.ts`
- Create: `src/core/punch/server/repository/balance.ts`
- Create: `src/core/consumption/server/postgres-mock-chain.ts`
- Test: `src/core/consumption/server/__tests__/postgres-mock-chain.test.ts`

**Interfaces:**
- Consumes: `ConsumerTransactionStatus` (Task 1), `DbClient` (Task 3), row types from Task 3.
- Produces:
```typescript
export interface ConsumerChainPort {
    submitConsumption(input: {
        proofId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission>;
    submitPunchRedemption(input: {
        redemptionRequestId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission>;
    submitVoucherRedemption(input: {
        redemptionRequestId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission>;
    getTransactionStatus(transactionId: string): Promise<ChainTransactionStatus>;
    getPunchBalance(userId: string): Promise<number>;
}
export type ChainSubmission = {
    transactionId: string;
    status: ConsumerTransactionStatus;
};
export type ChainTransactionStatus = ChainSubmission & {
    rejectionReason?: string;
};
export class ConsumerChainError extends Error {
    constructor(public code: string, message?: string);
}
```
This task implements `getTransactionStatus` and `getPunchBalance` on `PostgresMockConsumerChain`; `submitConsumption`/`submitPunchRedemption`/`submitVoucherRedemption` are stubbed to throw `"not implemented"` and completed in Tasks 6, 8, 9.

- [ ] **Step 1: Write the port and error type**

```typescript
// src/core/consumption/server/chain-port.ts
import "server-only";
import type { ConsumerTransactionStatus } from "@/core/consumption/domain/transitions";

export type ChainSubmission = {
    transactionId: string;
    status: ConsumerTransactionStatus;
};
export type ChainTransactionStatus = ChainSubmission & {
    rejectionReason?: string;
};

export interface ConsumerChainPort {
    submitConsumption(input: {
        proofId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission>;
    submitPunchRedemption(input: {
        redemptionRequestId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission>;
    submitVoucherRedemption(input: {
        redemptionRequestId: string;
        idempotencyKey: string;
    }): Promise<ChainSubmission>;
    getTransactionStatus(transactionId: string): Promise<ChainTransactionStatus>;
    getPunchBalance(userId: string): Promise<number>;
}

export class ConsumerChainError extends Error {
    constructor(
        public code:
            | "PROOF_NOT_FOUND"
            | "PROOF_NOT_CONFIRMED"
            | "PROOF_EXPIRED"
            | "REQUEST_NOT_FOUND"
            | "REQUEST_NOT_APPROVED"
            | "INSUFFICIENT_BALANCE"
            | "TRANSACTION_NOT_FOUND"
            | "UNSUPPORTED_OPERATION",
        message?: string,
    ) {
        super(message ?? code);
        this.name = "ConsumerChainError";
    }
}
```

- [ ] **Step 2: Write repository files**

```typescript
// src/core/consumption/server/repository/proofs.ts
import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db, type DbClient } from "@/server/drizzle/db";
import {
    consumptionProof,
    type ConsumptionProofRow,
    type NewConsumptionProofRow,
} from "@/server/drizzle/schemas/consumption-schema";

export async function createProof(
    input: Omit<NewConsumptionProofRow, "id" | "createdAt" | "updatedAt">,
): Promise<ConsumptionProofRow> {
    const [row] = await db.insert(consumptionProof).values(input).returning();
    if (!row) throw new Error("createProof: insert returned no row");
    return row;
}

export async function findProofById(
    id: string,
    client: DbClient = db,
): Promise<ConsumptionProofRow | null> {
    const [row] = await client
        .select()
        .from(consumptionProof)
        .where(eq(consumptionProof.id, id));
    return row ?? null;
}

export async function findProofByNonceOrReceipt(
    nonce: string,
    receiptHash: string,
): Promise<ConsumptionProofRow | null> {
    const [row] = await db
        .select()
        .from(consumptionProof)
        .where(
            or(
                eq(consumptionProof.nonce, nonce),
                eq(consumptionProof.receiptHash, receiptHash),
            ),
        );
    return row ?? null;
}

export async function bindProofSignatures(
    id: string,
    consumerUserId: string,
    cafeSignature: string,
    consumerSignature: string,
): Promise<ConsumptionProofRow> {
    const [row] = await db
        .update(consumptionProof)
        .set({ status: "confirmed", consumerUserId, cafeSignature, consumerSignature })
        .where(and(eq(consumptionProof.id, id), eq(consumptionProof.status, "issued")))
        .returning();
    if (!row) throw new Error("bindProofSignatures: proof not issued or not found");
    return row;
}
```

```typescript
// src/core/consumption/server/repository/transactions.ts
import "server-only";
import { eq } from "drizzle-orm";
import { db, type DbClient } from "@/server/drizzle/db";
import {
    consumerTransaction,
    type ConsumerTransactionRow,
    type NewConsumerTransactionRow,
} from "@/server/drizzle/schemas/consumption-schema";

export async function createTransaction(
    client: DbClient,
    input: Omit<NewConsumerTransactionRow, "id" | "createdAt" | "updatedAt">,
): Promise<ConsumerTransactionRow> {
    const [row] = await client.insert(consumerTransaction).values(input).returning();
    if (!row) throw new Error("createTransaction: insert returned no row");
    return row;
}

export async function findTransactionByIdempotencyKey(
    key: string,
): Promise<ConsumerTransactionRow | null> {
    const [row] = await db
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.idempotencyKey, key));
    return row ?? null;
}

export async function findTransactionByProofId(
    client: DbClient,
    proofId: string,
): Promise<ConsumerTransactionRow | null> {
    const [row] = await client
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.proofId, proofId));
    return row ?? null;
}

export async function findTransactionByRedemptionRequestId(
    client: DbClient,
    redemptionRequestId: string,
): Promise<ConsumerTransactionRow | null> {
    const [row] = await client
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.redemptionRequestId, redemptionRequestId));
    return row ?? null;
}

export async function findTransactionById(
    id: string,
    client: DbClient = db,
): Promise<ConsumerTransactionRow | null> {
    const [row] = await client
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.id, id));
    return row ?? null;
}

export async function updateTransactionStatus(
    client: DbClient,
    id: string,
    status: ConsumerTransactionRow["status"],
    rejectionReason: string | null = null,
): Promise<ConsumerTransactionRow> {
    const [row] = await client
        .update(consumerTransaction)
        .set({ status, rejectionReason })
        .where(eq(consumerTransaction.id, id))
        .returning();
    if (!row) throw new Error("updateTransactionStatus: transaction not found");
    return row;
}
```

```typescript
// src/core/consumption/server/repository/redemption-requests.ts
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, type DbClient } from "@/server/drizzle/db";
import {
    redemptionRequest,
    type NewRedemptionRequestRow,
    type RedemptionRequestRow,
} from "@/server/drizzle/schemas/consumption-schema";

export async function createRedemptionRequest(
    input: Omit<NewRedemptionRequestRow, "id" | "createdAt" | "updatedAt">,
): Promise<RedemptionRequestRow> {
    const [row] = await db.insert(redemptionRequest).values(input).returning();
    if (!row) throw new Error("createRedemptionRequest: insert returned no row");
    return row;
}

export async function findRedemptionRequestById(
    id: string,
    client: DbClient = db,
): Promise<RedemptionRequestRow | null> {
    const [row] = await client
        .select()
        .from(redemptionRequest)
        .where(eq(redemptionRequest.id, id));
    return row ?? null;
}

export async function decideRedemptionRequest(
    id: string,
    decidedByUserId: string,
    decision: "approved" | "rejected",
    rejectionReason: string | null,
): Promise<RedemptionRequestRow> {
    const [row] = await db
        .update(redemptionRequest)
        .set({ status: decision, decidedByUserId, rejectionReason })
        .where(
            and(eq(redemptionRequest.id, id), eq(redemptionRequest.status, "pending")),
        )
        .returning();
    if (!row) throw new Error("decideRedemptionRequest: request not pending or not found");
    return row;
}

export async function listPendingRequestsForCafe(
    cafeId: string,
): Promise<RedemptionRequestRow[]> {
    return db
        .select()
        .from(redemptionRequest)
        .where(
            and(
                eq(redemptionRequest.cafeId, cafeId),
                eq(redemptionRequest.status, "pending"),
            ),
        )
        .orderBy(desc(redemptionRequest.createdAt));
}
```

```typescript
// src/core/punch/server/repository/balance.ts
import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, type DbClient } from "@/server/drizzle/db";
import { punchBalanceProjection } from "@/server/drizzle/schemas/punch-schema";

export async function getBalance(userId: string): Promise<number> {
    const [row] = await db
        .select({ balance: punchBalanceProjection.balance })
        .from(punchBalanceProjection)
        .where(eq(punchBalanceProjection.userId, userId));
    return row?.balance ?? 0;
}

export async function incrementBalance(
    client: DbClient,
    userId: string,
    amount: number,
): Promise<number> {
    const [row] = await client
        .insert(punchBalanceProjection)
        .values({ userId, balance: amount })
        .onConflictDoUpdate({
            target: punchBalanceProjection.userId,
            set: { balance: sql`${punchBalanceProjection.balance} + ${amount}` },
        })
        .returning({ balance: punchBalanceProjection.balance });
    if (!row) throw new Error("incrementBalance: upsert returned no row");
    return row.balance;
}

export async function decrementBalance(
    client: DbClient,
    userId: string,
    amount: number,
): Promise<number> {
    const [row] = await client
        .update(punchBalanceProjection)
        .set({ balance: sql`${punchBalanceProjection.balance} - ${amount}` })
        .where(eq(punchBalanceProjection.userId, userId))
        .returning({ balance: punchBalanceProjection.balance });
    if (!row || row.balance < 0) {
        throw new Error("decrementBalance: balance would go negative");
    }
    return row.balance;
}
```

- [ ] **Step 3: Write the failing contract test for the read paths**

```typescript
// src/core/consumption/server/__tests__/postgres-mock-chain.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repository/transactions", () => ({
    findTransactionById: vi.fn(),
    findTransactionByIdempotencyKey: vi.fn(),
    findTransactionByProofId: vi.fn(),
    findTransactionByRedemptionRequestId: vi.fn(),
    createTransaction: vi.fn(),
}));
vi.mock("../repository/proofs", () => ({
    findProofById: vi.fn(),
    bindProofSignatures: vi.fn(),
}));
vi.mock("../repository/redemption-requests", () => ({
    findRedemptionRequestById: vi.fn(),
}));
vi.mock("@/core/punch/server/repository/balance", () => ({
    getBalance: vi.fn(),
    incrementBalance: vi.fn(),
    decrementBalance: vi.fn(),
}));

import { getBalance } from "@/core/punch/server/repository/balance";
import { ConsumerChainError } from "../chain-port";
import { findTransactionById } from "../repository/transactions";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";

describe("PostgresMockConsumerChain.getPunchBalance", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns the projected balance", async () => {
        vi.mocked(getBalance).mockResolvedValue(11);
        const chain = new PostgresMockConsumerChain();
        expect(await chain.getPunchBalance("user-1")).toBe(11);
    });
});

describe("PostgresMockConsumerChain.getTransactionStatus", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns the transaction's current status", async () => {
        vi.mocked(findTransactionById).mockResolvedValue({
            id: "tx-1",
            status: "confirmed",
            rejectionReason: null,
        } as never);
        const chain = new PostgresMockConsumerChain();
        expect(await chain.getTransactionStatus("tx-1")).toEqual({
            transactionId: "tx-1",
            status: "confirmed",
            rejectionReason: undefined,
        });
    });

    it("throws TRANSACTION_NOT_FOUND for an unknown id", async () => {
        vi.mocked(findTransactionById).mockResolvedValue(null);
        const chain = new PostgresMockConsumerChain();
        await expect(chain.getTransactionStatus("missing")).rejects.toThrow(
            ConsumerChainError,
        );
    });
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `pnpm vitest run src/core/consumption/server/__tests__/postgres-mock-chain.test.ts`
Expected: FAIL — `Cannot find module '../postgres-mock-chain'`

- [ ] **Step 5: Implement `postgres-mock-chain.ts` (read paths only; write paths throw for now)**

```typescript
// src/core/consumption/server/postgres-mock-chain.ts
import "server-only";
import { getBalance } from "@/core/punch/server/repository/balance";
import type {
    ChainSubmission,
    ChainTransactionStatus,
    ConsumerChainPort,
} from "./chain-port";
import { ConsumerChainError } from "./chain-port";
import { findTransactionById } from "./repository/transactions";

/**
 * PostgreSQL-backed mock of the real chain. This is the ONLY module allowed
 * to treat consumption/punch tables as command authority — everything else
 * treats them as read projections. Replace with ViemConsumerChain later
 * without touching ConsumerChainPort's callers.
 */
export class PostgresMockConsumerChain implements ConsumerChainPort {
    async getPunchBalance(userId: string): Promise<number> {
        return getBalance(userId);
    }

    async getTransactionStatus(
        transactionId: string,
    ): Promise<ChainTransactionStatus> {
        const row = await findTransactionById(transactionId);
        if (!row) {
            throw new ConsumerChainError(
                "TRANSACTION_NOT_FOUND",
                `Transaction ${transactionId} not found`,
            );
        }
        return {
            transactionId: row.id,
            status: row.status,
            rejectionReason: row.rejectionReason ?? undefined,
        };
    }

    async submitConsumption(): Promise<ChainSubmission> {
        throw new ConsumerChainError("UNSUPPORTED_OPERATION", "Mock emission write is disabled until Task 6");
    }

    async submitPunchRedemption(): Promise<ChainSubmission> {
        throw new ConsumerChainError("UNSUPPORTED_OPERATION", "Mock PUNCH redemption write is disabled until Task 8");
    }

    async submitVoucherRedemption(): Promise<ChainSubmission> {
        throw new ConsumerChainError("UNSUPPORTED_OPERATION", "Mock voucher redemption write is disabled until Task 9");
    }
}
```

- [ ] **Step 6: Run and confirm pass**

Run: `pnpm vitest run src/core/consumption/server/__tests__/postgres-mock-chain.test.ts` → PASS (3 tests)

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/core/consumption/server src/core/punch/server/repository/balance.ts
git commit -m "feat(consumption): add ConsumerChainPort, repositories, and mock chain read paths"
```

---

### Task 5: Café purchase-proof generation (EIP-712 signing)

**Files:**
- Create: `src/core/consumption/server/demo-chain-context.ts`
- Create: `src/core/consumption/server/services/create-purchase-proof-service.ts`
- Create: `src/core/consumption/server/api/routes/create-purchase-proof.route.ts`
- Create: `src/core/consumption/server/api/routes/get-purchase-proof.route.ts`
- Create: `src/core/consumption/server/api/router.ts`
- Test: `src/core/consumption/server/services/__tests__/create-purchase-proof-service.test.ts`

**Interfaces:**
- Consumes: `assignWallet(userId)` → `{ walletIndex, address }` and `deriveUserAccount(walletIndex)` (`src/core/chain/server/wallet/assign-wallet.ts`, `derive.ts`), `requireCafeRole(userId, cafeId, roles)` (`src/server/auth/membership/require-cafe-role.ts`), `findCafeById` / `findProductById` (`src/core/cafe/server/repository`), `createProof` (Task 4), `generateNonce`, `purchaseProofDomain`, `PURCHASE_PROOF_TYPES`, `PURCHASE_PROOF_TTL_SECONDS` (Task 1), and demo-only constants from `demo-chain-context.ts`.
- Produces: `createPurchaseProofService(baristaUserId, cafeId, input: CreatePurchaseProof): AsyncAppResult<PurchaseProofIssued>` where `PurchaseProofIssued = { id: string; expiresAt: string; deepLink: string }`. QR exposes only opaque proof ID. Stored draft uses `UNBOUND_CONSUMER_ADDRESS`; Task 6 replaces draft signature with two signatures over one consumer-bound final payload.

- [ ] **Step 1: Write the failing service test**

```typescript
// src/core/consumption/server/services/__tests__/create-purchase-proof-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/proofs", () => ({ createProof: vi.fn() }));
vi.mock("@/core/cafe/server/repository/find-cafe-by-id", () => ({
    findCafeById: vi.fn(),
}));
vi.mock("@/core/cafe/server/repository/find-product-by-id", () => ({
    findProductById: vi.fn(),
}));
vi.mock("@/core/chain/server/wallet/assign-wallet", () => ({
    assignWallet: vi.fn(),
}));
vi.mock(
    "@/server/auth/membership/require-cafe-role",
    async (importOriginal) => {
        const actual =
            await importOriginal<
                typeof import("@/server/auth/membership/require-cafe-role")
            >();
        return { ...actual, requireCafeRole: vi.fn() };
    },
);

import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { findCafeById } from "@/core/cafe/server/repository/find-cafe-by-id";
import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { ok as okResult } from "@/server/common/responses";
import { createProof } from "../../repository/proofs";
import { createPurchaseProofService } from "../create-purchase-proof-service";

const membership = {
    id: "m1",
    userId: "barista-1",
    cafeId: "cafe-1",
    role: "barista" as const,
    createdAt: new Date(),
};
const cafeRow = {
    id: "cafe-1",
    onboardingStatus: "approved" as const,
};
const productRow = {
    id: "product-1",
    cafeId: "cafe-1",
    type: "emission" as const,
    approvalStatus: "approved" as const,
    active: true,
    priceSoles: "8.00",
};

describe("createPurchaseProofService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("forbids a user without barista/owner membership", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue({
            ok: false,
            error: { type: "ForbiddenError", code: "FORBIDDEN", status: 403 },
        });
        const result = await createPurchaseProofService("outsider", "cafe-1", {
            productId: "product-1",
            receiptHash: `0x${"ab".repeat(32)}`,
        });
        expect(result.ok).toBe(false);
    });

    it("rejects a product that cannot emit PUNCH", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue(cafeRow as never);
        vi.mocked(findProductById).mockResolvedValue({
            ...productRow,
            type: "reward",
        } as never);
        const result = await createPurchaseProofService("barista-1", "cafe-1", {
            productId: "product-1",
            receiptHash: `0x${"ab".repeat(32)}`,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it("signs and persists a proof for a valid emission product", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue(cafeRow as never);
        vi.mocked(findProductById).mockResolvedValue(productRow as never);
        vi.mocked(assignWallet).mockResolvedValue({
            walletIndex: 0,
            address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226",
        });
        vi.mocked(createProof).mockImplementation(async (input) => ({
            ...input,
            id: "proof-1",
            createdAt: new Date(),
            updatedAt: new Date(),
        }));
        const result = await createPurchaseProofService("barista-1", "cafe-1", {
            productId: "product-1",
            receiptHash: `0x${"ab".repeat(32)}`,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.deepLink).toBe("/purchase/proof-1");
        expect(createProof).toHaveBeenCalledWith(
            expect.objectContaining({
                cafeId: "cafe-1",
                productId: "product-1",
                amountCentimos: 800,
                cafeSignature: expect.stringMatching(/^0x[0-9a-f]{130}$/),
                status: "issued",
            }),
        );
    });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/create-purchase-proof-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the service**

```typescript
// src/core/consumption/server/demo-chain-context.ts
import "server-only";

export const DEMO_CONSUMPTION_VERIFIER_ADDRESS =
    "0x00000000000000000000000000000000000000FA" as const;
export const UNBOUND_CONSUMER_ADDRESS =
    "0x0000000000000000000000000000000000000000" as const;

// src/core/consumption/server/services/create-purchase-proof-service.ts
import "server-only";
import { chain } from "@/core/chain/chain";
import {
    DEMO_CONSUMPTION_VERIFIER_ADDRESS,
    UNBOUND_CONSUMER_ADDRESS,
} from "../demo-chain-context";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import { findCafeById } from "@/core/cafe/server/repository/find-cafe-by-id";
import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import {
    PURCHASE_PROOF_TTL_SECONDS,
    PURCHASE_PROOF_TYPES,
    purchaseProofDomain,
    type PurchaseProofMessage,
} from "@/core/consumption/domain/eip712";
import { generateNonce } from "@/core/consumption/domain/nonce";
import type { CreatePurchaseProof } from "@/core/consumption/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { createProof } from "../repository/proofs";

export type PurchaseProofIssued = {
    id: string;
    expiresAt: string;
    deepLink: string;
};

const soleToCentimos = (priceSoles: string) => Math.round(Number(priceSoles) * 100);

export async function createPurchaseProofService(
    baristaUserId: string,
    cafeId: string,
    input: CreatePurchaseProof,
): AsyncAppResult<PurchaseProofIssued> {
    const membershipResult = await requireCafeRole(baristaUserId, cafeId, [
        "owner",
        "barista",
    ]);
    if (!membershipResult.ok) return err(membershipResult.error);

    const cafeRow = await findCafeById(cafeId);
    if (!cafeRow || cafeRow.onboardingStatus !== "approved") {
        return err(AppErrors.notFound({ targets: ["cafeId"] }));
    }

    const product = await findProductById(input.productId);
    if (!product || product.cafeId !== cafeId) {
        return err(AppErrors.notFound({ targets: ["productId"] }));
    }
    if (
        product.type !== "emission" ||
        product.approvalStatus !== "approved" ||
        !product.active
    ) {
        return err(
            AppErrors.unprocessableEntity({
                targets: ["productId"],
                cause: "Este producto no puede emitir PUNCH.",
            }),
        );
    }

    const wallet = await assignWallet(baristaUserId);
    const account = deriveUserAccount(wallet.walletIndex);

    const nonce = generateNonce();
    const now = Math.floor(Date.now() / 1000);
    const expiry = BigInt(now + PURCHASE_PROOF_TTL_SECONDS);
    const verifyingContract = DEMO_CONSUMPTION_VERIFIER_ADDRESS;

    // Barista does not know consumer yet. This signed draft authorizes product,
    // amount, nonce, and expiry. Task 6 binds user and creates both final signatures.
    const payload: PurchaseProofMessage = {
        cafeId,
        user: UNBOUND_CONSUMER_ADDRESS,
        productId: input.productId,
        amountCentimos: BigInt(soleToCentimos(product.priceSoles)),
        receiptHash: input.receiptHash as `0x${string}`,
        nonce,
        expiry,
        chainId: BigInt(chain.id),
        verifyingContract,
    };

    const cafeDraftSignature = await account.signTypedData({
        domain: purchaseProofDomain({ verifyingContract, chainId: chain.id }),
        types: PURCHASE_PROOF_TYPES,
        primaryType: "PurchaseProof",
        message: payload,
    });

    const row = await createProof({
        cafeId,
        productId: input.productId,
        issuedByUserId: baristaUserId,
        amountCentimos: soleToCentimos(product.priceSoles),
        receiptHash: input.receiptHash,
        nonce,
        cafeSignature: cafeDraftSignature,
        status: "issued",
        expiresAt: new Date(Number(expiry) * 1000),
    });

    return ok({
        id: row.id,
        expiresAt: row.expiresAt.toISOString(),
        deepLink: `/purchase/${row.id}`,
    });
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/create-purchase-proof-service.test.ts` → PASS (3 tests)

- [ ] **Step 5: Add the routes and router**

```typescript
// src/core/consumption/server/api/routes/create-purchase-proof.route.ts
import { Elysia, t } from "elysia";
import { createPurchaseProofSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { createPurchaseProofService } from "../../services/create-purchase-proof-service";

export const createPurchaseProofRoute = new Elysia().use(authed).post(
    "/:cafeId/purchase-proofs",
    async ({ user, params, body, status }) => {
        const result = await createPurchaseProofService(
            user.id,
            params.cafeId,
            body,
        );
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String() }),
        body: createPurchaseProofSchema,
        response: {
            201: t.Object({
                status: t.Literal(201),
                response: t.Object({
                    id: t.String(),
                    expiresAt: t.String(),
                    deepLink: t.String(),
                }),
            }),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Consumption"], summary: "Generate a purchase proof" },
    },
);
```

```typescript
// src/core/consumption/server/api/routes/get-purchase-proof.route.ts
import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
} from "@/server/common/responses";
import { findProofById } from "../../repository/proofs";

export const getPurchaseProofRoute = new Elysia().use(authed).get(
    "/purchase-proofs/:proofId",
    async ({ params, status }) => {
        const row = await findProofById(params.proofId);
        if (!row) return status(404, CommonResponse.notFound());
        return status(
            200,
            CommonResponse.successful({
                response: {
                    id: row.id,
                    cafeId: row.cafeId,
                    productId: row.productId,
                    amountCentimos: row.amountCentimos,
                    expiresAt: row.expiresAt.toISOString(),
                    status: row.status,
                    createdAt: row.createdAt.toISOString(),
                },
            }),
        );
    },
    {
        authed: true,
        params: t.Object({ proofId: t.String() }),
        response: {
            200: t.Object({
                status: t.Literal(200),
                response: t.Object({
                    id: t.String(),
                    cafeId: t.String(),
                    productId: t.String(),
                    amountCentimos: t.Number(),
                    expiresAt: t.String(),
                    status: t.String(),
                    createdAt: t.String(),
                }),
            }),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
        },
        detail: { tags: ["Consumption"], summary: "Get a purchase proof" },
    },
);
```

```typescript
// src/core/consumption/server/api/router.ts
import { Elysia } from "elysia";
import { createPurchaseProofRoute } from "./routes/create-purchase-proof.route";
import { getPurchaseProofRoute } from "./routes/get-purchase-proof.route";

export const consumptionRouter = new Elysia({ prefix: "/consumption" })
    .use(createPurchaseProofRoute)
    .use(getPurchaseProofRoute);
```

Note: `errorToResponse`/`CommonResponse` names come from `src/server/common/responses/index.ts`; confirm exact exports by reading that file before writing this step against the live repo (`CommonResponse.successful`, `CommonResponse.created`, `CommonResponse.notFound`, `errorToResponse`, `errorResponseSchema`, `createdResponseSchema` are already used by `src/core/cafe/server/api/routes/*`).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/core/consumption/server/services/create-purchase-proof-service.ts \
        src/core/consumption/server/api
git commit -m "feat(consumption): add café EIP-712 purchase-proof generation"
```

---

### Task 6: Consumer confirmation + `submitConsumption` (atomic emission, replay-safe)

**Files:**
- Create: `src/core/consumption/server/services/confirm-purchase-service.ts`
- Create: `src/core/consumption/server/api/routes/confirm-purchase.route.ts`
- Create: `src/core/consumption/server/api/routes/get-transaction.route.ts`
- Modify: `src/core/consumption/server/postgres-mock-chain.ts` (implement `submitConsumption`)
- Modify: `src/core/consumption/server/api/router.ts` (register new routes)
- Test: `src/core/consumption/server/__tests__/postgres-mock-chain.test.ts` (extend)
- Test: `src/core/consumption/server/services/__tests__/confirm-purchase-service.test.ts`

**Interfaces:**
- Consumes: `ConsumerChainPort.submitConsumption` (Task 4), `bindProofSignatures`, `findProofById` (Task 4), `assignWallet`/`deriveUserAccount` (chain wallet), `db.transaction` (`src/server/drizzle/db.ts`).
- Produces: `confirmPurchaseService(consumerUserId, input: ConfirmPurchase): AsyncAppResult<{ transactionId: string; status: ConsumerTransactionStatus }>`.

- [ ] **Step 1: Extend the mock-chain test with `submitConsumption` cases**

```typescript
// src/core/consumption/server/__tests__/postgres-mock-chain.test.ts (add below existing describes)
import { db } from "@/server/drizzle/db";
import {
    createTransaction,
    findTransactionByIdempotencyKey,
    findTransactionByProofId,
} from "../repository/transactions";
import { findProofById } from "../repository/proofs";
import { incrementBalance } from "@/core/punch/server/repository/balance";

vi.mock("@/server/drizzle/db", () => ({
    db: { transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})) },
}));

describe("PostgresMockConsumerChain.submitConsumption", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns the existing transaction on a duplicate idempotency key", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue({
            id: "tx-1",
            status: "confirmed",
        } as never);
        const chain = new PostgresMockConsumerChain();
        const result = await chain.submitConsumption({
            proofId: "proof-1",
            idempotencyKey: "key-1",
        });
        expect(result).toEqual({ transactionId: "tx-1", status: "confirmed" });
        expect(db.transaction).not.toHaveBeenCalled();
    });

    it("throws PROOF_NOT_CONFIRMED for an issued-but-unconfirmed proof", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            status: "issued",
            consumerUserId: null,
            cafeId: "cafe-1",
            expiresAt: new Date(Date.now() + 60_000),
        } as never);
        const chain = new PostgresMockConsumerChain();
        await expect(
            chain.submitConsumption({ proofId: "proof-1", idempotencyKey: "key-2" }),
        ).rejects.toMatchObject({ code: "PROOF_NOT_CONFIRMED" });
    });

    it("throws PROOF_EXPIRED for a confirmed-but-expired proof", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            status: "confirmed",
            consumerUserId: "user-1",
            cafeId: "cafe-1",
            expiresAt: new Date(Date.now() - 1000),
        } as never);
        const chain = new PostgresMockConsumerChain();
        await expect(
            chain.submitConsumption({ proofId: "proof-1", idempotencyKey: "key-3" }),
        ).rejects.toMatchObject({ code: "PROOF_EXPIRED" });
    });

    it("is replay-safe on a second confirmed submission for the same proof", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            status: "confirmed",
            consumerUserId: "user-1",
            cafeId: "cafe-1",
            expiresAt: new Date(Date.now() + 60_000),
        } as never);
        vi.mocked(findTransactionByProofId).mockResolvedValue({
            id: "tx-existing",
            status: "confirmed",
        } as never);
        const chain = new PostgresMockConsumerChain();
        const result = await chain.submitConsumption({
            proofId: "proof-1",
            idempotencyKey: "key-4",
        });
        expect(result).toEqual({ transactionId: "tx-existing", status: "confirmed" });
        expect(createTransaction).not.toHaveBeenCalled();
        expect(incrementBalance).not.toHaveBeenCalled();
    });

    it("creates one pending transaction without changing balance", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            status: "confirmed",
            consumerUserId: "user-1",
            cafeId: "cafe-1",
            expiresAt: new Date(Date.now() + 60_000),
        } as never);
        vi.mocked(findTransactionByProofId).mockResolvedValue(null);
        vi.mocked(createTransaction).mockResolvedValue({
            id: "tx-new",
            status: "pending",
        } as never);
        const result = await new PostgresMockConsumerChain().submitConsumption({
            proofId: "proof-1",
            idempotencyKey: "key-5",
        });
        expect(result).toEqual({ transactionId: "tx-new", status: "pending" });
        expect(incrementBalance).not.toHaveBeenCalled();
    });
});
```

Also add mocks at the top of the file (alongside the existing `vi.mock` calls from Task 4): `vi.mock("@/server/drizzle/db", ...)` as shown, and ensure `createTransaction`, `findTransactionByProofId` are already covered by the Task 4 `vi.mock("../repository/transactions", ...)` block — extend that block to include them if not already present.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/core/consumption/server/__tests__/postgres-mock-chain.test.ts`
Expected: FAIL — `submitConsumption` still throws `ConsumerChainError("UNSUPPORTED_OPERATION")`.

- [ ] **Step 3: Implement `submitConsumption`**

```typescript
// src/core/consumption/server/postgres-mock-chain.ts (replace the submitConsumption stub)
import { incrementBalance } from "@/core/punch/server/repository/balance";
import { db } from "@/server/drizzle/db";
import { findProofById } from "./repository/proofs";
import {
    createTransaction,
    findTransactionByIdempotencyKey,
    findTransactionByProofId,
} from "./repository/transactions";

// ...inside the class, replacing the earlier stub:
async submitConsumption(input: {
    proofId: string;
    idempotencyKey: string;
}): Promise<ChainSubmission> {
    const existing = await findTransactionByIdempotencyKey(input.idempotencyKey);
    if (existing) return { transactionId: existing.id, status: existing.status };

    return db.transaction(async (tx) => {
        const proof = await findProofById(input.proofId, tx);
        if (!proof) throw new ConsumerChainError("PROOF_NOT_FOUND");
        if (proof.status !== "confirmed" || !proof.consumerUserId) {
            throw new ConsumerChainError("PROOF_NOT_CONFIRMED");
        }
        if (proof.expiresAt.getTime() < Date.now()) {
            throw new ConsumerChainError("PROOF_EXPIRED");
        }

        const already = await findTransactionByProofId(tx, proof.id);
        if (already) return { transactionId: already.id, status: already.status };

        const row = await createTransaction(tx, {
            operation: "emission",
            consumerUserId: proof.consumerUserId,
            cafeId: proof.cafeId,
            proofId: proof.id,
            chainTxId: `mock_${crypto.randomUUID()}`,
            status: "pending",
            idempotencyKey: input.idempotencyKey,
        });
        return { transactionId: row.id, status: row.status };
    });
}
```

Add delayed finalization to the same adapter. Constructor receives time for deterministic tests:

```typescript
const MOCK_CONFIRM_DELAY_MS = 750;

export class PostgresMockConsumerChain implements ConsumerChainPort {
    constructor(
        private readonly now: () => number = Date.now,
        private readonly confirmDelayMs = MOCK_CONFIRM_DELAY_MS,
    ) {}

    async getTransactionStatus(transactionId: string): Promise<ChainTransactionStatus> {
        const row = await findTransactionById(transactionId);
        if (!row) throw new ConsumerChainError("TRANSACTION_NOT_FOUND");
        if (
            row.status !== "pending" ||
            this.now() - row.createdAt.getTime() < this.confirmDelayMs
        ) {
            return {
                transactionId: row.id,
                status: row.status,
                rejectionReason: row.rejectionReason ?? undefined,
            };
        }
        return this.finalizePendingTransaction(row.id);
    }

    private async finalizePendingTransaction(
        transactionId: string,
    ): Promise<ChainTransactionStatus> {
        return db.transaction(async (tx) => {
            const row = await findTransactionById(transactionId, tx);
            if (!row) throw new ConsumerChainError("TRANSACTION_NOT_FOUND");
            if (row.status !== "pending") {
                return { transactionId: row.id, status: row.status };
            }
            if (row.operation !== "emission" || !row.proofId) {
                throw new ConsumerChainError("UNSUPPORTED_OPERATION");
            }
            const proof = await findProofById(row.proofId, tx);
            if (!proof?.consumerUserId) throw new ConsumerChainError("PROOF_NOT_CONFIRMED");
            await incrementBalance(tx, proof.consumerUserId, 1);
            const confirmed = await updateTransactionStatus(tx, row.id, "confirmed");
            return { transactionId: confirmed.id, status: confirmed.status };
        });
    }
}
```

Extend test with fake time: pending row created at `t=0` returns pending at `t=749`; at `t=750`, `getTransactionStatus` calls `incrementBalance(..., 1)` and `updateTransactionStatus(..., "confirmed")`; a second poll of confirmed row calls neither mutation. This is the idempotency proof for visible `Pendiente on-chain → Confirmado`.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm vitest run src/core/consumption/server/__tests__/postgres-mock-chain.test.ts` → PASS (10 tests total)

- [ ] **Step 5: Write the failing service test**

```typescript
// src/core/consumption/server/services/__tests__/confirm-purchase-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/proofs", () => ({
    findProofById: vi.fn(),
    bindProofSignatures: vi.fn(),
}));
vi.mock("@/core/chain/server/wallet/assign-wallet", () => ({
    assignWallet: vi.fn(),
}));

import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { findProofById, bindProofSignatures } from "../../repository/proofs";
import { confirmPurchaseService } from "../confirm-purchase-service";
import { PostgresMockConsumerChain } from "../../postgres-mock-chain";

vi.mock("../../postgres-mock-chain", () => ({
    PostgresMockConsumerChain: vi.fn().mockImplementation(() => ({
        submitConsumption: vi.fn().mockResolvedValue({
            transactionId: "tx-1",
            status: "pending",
        }),
    })),
}));

describe("confirmPurchaseService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("rejects an expired proof before signing", async () => {
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            status: "issued",
            expiresAt: new Date(Date.now() - 1000),
        } as never);
        const result = await confirmPurchaseService("user-1", {
            proofId: "proof-1",
        });
        expect(result.ok).toBe(false);
    });

    it("confirms, signs, and submits through the chain port", async () => {
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            status: "issued",
            expiresAt: new Date(Date.now() + 60_000),
        } as never);
        vi.mocked(assignWallet).mockResolvedValue({
            walletIndex: 1,
            address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        });
        vi.mocked(bindProofSignatures).mockResolvedValue({
            id: "proof-1",
        } as never);
        const result = await confirmPurchaseService("user-1", {
            proofId: "proof-1",
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({
                transactionId: "tx-1",
                status: "pending",
            });
        }
    });
});
```

- [ ] **Step 6: Run and confirm failure**

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/confirm-purchase-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Implement the service**

```typescript
// src/core/consumption/server/services/confirm-purchase-service.ts
import "server-only";
import { chain } from "@/core/chain/chain";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import {
    PURCHASE_PROOF_TYPES,
    purchaseProofDomain,
    type PurchaseProofMessage,
} from "@/core/consumption/domain/eip712";
import type { ConfirmPurchase } from "@/core/consumption/domain/types";
import { DEMO_CONSUMPTION_VERIFIER_ADDRESS } from "../demo-chain-context";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findProofById, bindProofSignatures } from "../repository/proofs";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import type { ChainSubmission } from "../chain-port";

export async function confirmPurchaseService(
    consumerUserId: string,
    input: ConfirmPurchase,
): AsyncAppResult<ChainSubmission> {
    const proof = await findProofById(input.proofId);
    if (!proof) return err(AppErrors.notFound({ targets: ["proofId"] }));
    if (proof.expiresAt.getTime() < Date.now()) {
        return err(
            AppErrors.unprocessableEntity({
                targets: ["proofId"],
                cause: "Pide al barista uno nuevo.",
            }),
        );
    }

    const consumerWallet = await assignWallet(consumerUserId);
    const cafeWallet = await assignWallet(proof.issuedByUserId);
    const consumerAccount = deriveUserAccount(consumerWallet.walletIndex);
    const cafeAccount = deriveUserAccount(cafeWallet.walletIndex);
    const verifyingContract = DEMO_CONSUMPTION_VERIFIER_ADDRESS;
    const message: PurchaseProofMessage = {
        cafeId: proof.cafeId,
        user: consumerAccount.address,
        productId: proof.productId,
        amountCentimos: BigInt(proof.amountCentimos),
        receiptHash: proof.receiptHash as `0x${string}`,
        nonce: proof.nonce as `0x${string}`,
        expiry: BigInt(Math.floor(proof.expiresAt.getTime() / 1000)),
        chainId: BigInt(chain.id),
        verifyingContract,
    };
    const typedData = {
        domain: purchaseProofDomain({ verifyingContract, chainId: chain.id }),
        types: PURCHASE_PROOF_TYPES,
        primaryType: "PurchaseProof" as const,
        message,
    };
    const [cafeSignature, consumerSignature] = await Promise.all([
        cafeAccount.signTypedData(typedData),
        consumerAccount.signTypedData(typedData),
    ]);

    if (proof.status === "issued") {
        await bindProofSignatures(
            proof.id,
            consumerUserId,
            cafeSignature,
            consumerSignature,
        );
    }

    const chain = new PostgresMockConsumerChain();
    try {
        const submission = await chain.submitConsumption({
            proofId: proof.id,
            idempotencyKey: `emission:${proof.id}`,
        });
        return ok(submission);
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
```

- [ ] **Step 8: Run and confirm pass**

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/confirm-purchase-service.test.ts` → PASS (2 tests)

- [ ] **Step 9: Add routes and register on the router**

```typescript
// src/core/consumption/server/api/routes/confirm-purchase.route.ts
import { Elysia, t } from "elysia";
import { confirmPurchaseSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { confirmPurchaseService } from "../../services/confirm-purchase-service";

export const confirmPurchaseRoute = new Elysia().use(authed).post(
    "/purchases/confirm",
    async ({ user, body, status }) => {
        const result = await confirmPurchaseService(user.id, body);
        if (!result.ok)
            return status(result.error.status as 500, errorToResponse(result.error));
        return status(200, CommonResponse.successful({ response: result.data }));
    },
    {
        authed: true,
        body: confirmPurchaseSchema,
        response: {
            200: t.Object({
                status: t.Literal(200),
                response: t.Object({
                    transactionId: t.String(),
                    status: t.String(),
                }),
            }),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Consumption"], summary: "Confirm a purchase" },
    },
);
```

```typescript
// src/core/consumption/server/api/routes/get-transaction.route.ts
import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema } from "@/server/common/responses";
import { ConsumerChainError } from "../../chain-port";
import { PostgresMockConsumerChain } from "../../postgres-mock-chain";

export const getTransactionRoute = new Elysia().use(authed).get(
    "/transactions/:transactionId",
    async ({ params, status }) => {
        try {
            const result = await new PostgresMockConsumerChain().getTransactionStatus(
                params.transactionId,
            );
            return status(200, CommonResponse.successful({ response: result }));
        } catch (cause) {
            if (cause instanceof ConsumerChainError) {
                return status(404, CommonResponse.notFound());
            }
            throw cause;
        }
    },
    {
        authed: true,
        params: t.Object({ transactionId: t.String() }),
        response: {
            200: t.Object({
                status: t.Literal(200),
                response: t.Object({
                    transactionId: t.String(),
                    status: t.String(),
                    rejectionReason: t.Optional(t.String()),
                }),
            }),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
        },
        detail: { tags: ["Consumption"], summary: "Poll a transaction's status" },
    },
);
```

```typescript
// src/core/consumption/server/api/router.ts (replace)
import { Elysia } from "elysia";
import { confirmPurchaseRoute } from "./routes/confirm-purchase.route";
import { createPurchaseProofRoute } from "./routes/create-purchase-proof.route";
import { getPurchaseProofRoute } from "./routes/get-purchase-proof.route";
import { getTransactionRoute } from "./routes/get-transaction.route";

export const consumptionRouter = new Elysia({ prefix: "/consumption" })
    .use(createPurchaseProofRoute)
    .use(getPurchaseProofRoute)
    .use(confirmPurchaseRoute)
    .use(getTransactionRoute);
```

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck`

- [ ] **Step 11: Commit**

```bash
git add src/core/consumption/server
git commit -m "feat(consumption): confirm purchase and atomic replay-safe PUNCH emission"
```

---

### Task 7: Campaign eligibility and coffee-crawl advancement on confirmed purchase

**Files:**
- Create: `src/core/punch/server/repository/campaigns.ts`
- Create: `src/core/punch/server/repository/crawls.ts`
- Modify: `src/core/consumption/server/postgres-mock-chain.ts` (`submitConsumption` gains campaign/crawl evaluation)
- Test: `src/core/consumption/server/__tests__/postgres-mock-chain.test.ts` (extend)

**Interfaces:**
- Consumes: `isEligibleForAcquisitionCampaign`, `advanceCrawl` (Task 2).
- Produces:
```typescript
// campaigns.ts
export async function findActiveCampaignForCafe(client, cafeId): Promise<CampaignRow | null>;
export async function hasPriorPaidPurchase(client, userId, cafeId, beforeTransactionId: string): Promise<boolean>;
export async function unlockCampaignVoucher(client, input: { campaignId: string; consumerUserId: string; cafeId: string; expiresAt: Date }): Promise<ConsumerVoucherRow | null>; // null when already unlocked (unique-violation swallowed)

// crawls.ts
export async function findActiveCrawlForCafe(client, cafeId): Promise<CoffeeCrawlRow | null>;
export async function getCrawlSteps(client, crawlId): Promise<CoffeeCrawlStepRow[]>;
export async function getOrCreateCrawlProgress(client, crawlId, consumerUserId): Promise<ConsumerCrawlProgressRow>;
export async function advanceCrawlProgress(client, progressId: string, completedCafeIds: string[], completed: boolean): Promise<ConsumerCrawlProgressRow>;
export async function unlockCrawlVoucher(client, input: { crawlId: string; consumerUserId: string; expiresAt: Date }): Promise<ConsumerVoucherRow | null>;
```

- [ ] **Step 1: Extend `postgres-mock-chain.test.ts` with campaign/crawl assertions**

```typescript
// append to src/core/consumption/server/__tests__/postgres-mock-chain.test.ts
vi.mock("@/core/punch/server/repository/campaigns", () => ({
    findActiveCampaignForCafe: vi.fn(),
    hasPriorPaidPurchase: vi.fn(),
    unlockCampaignVoucher: vi.fn(),
}));
vi.mock("@/core/punch/server/repository/crawls", () => ({
    findActiveCrawlForCafe: vi.fn(),
    getCrawlSteps: vi.fn(),
    getOrCreateCrawlProgress: vi.fn(),
    advanceCrawlProgress: vi.fn(),
    unlockCrawlVoucher: vi.fn(),
}));

import {
    findActiveCampaignForCafe,
    hasPriorPaidPurchase,
    unlockCampaignVoucher,
} from "@/core/punch/server/repository/campaigns";
import {
    advanceCrawlProgress,
    findActiveCrawlForCafe,
    getCrawlSteps,
    getOrCreateCrawlProgress,
    unlockCrawlVoucher,
} from "@/core/punch/server/repository/crawls";

describe("PostgresMockConsumerChain.submitConsumption campaign + crawl side effects", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        vi.mocked(findProofById).mockResolvedValue({
            id: "proof-1",
            status: "confirmed",
            consumerUserId: "user-1",
            cafeId: "cafe-target",
            expiresAt: new Date(Date.now() + 60_000),
        } as never);
        vi.mocked(findTransactionByProofId).mockResolvedValue(null);
        vi.mocked(createTransaction).mockResolvedValue({
            id: "tx-new",
            status: "confirmed",
        } as never);
    });

    it("unlocks a campaign voucher on a qualifying first purchase", async () => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue({
            id: "campaign-1",
            cafeId: "cafe-target",
            windowStart: new Date(Date.now() - 86_400_000),
            windowEnd: new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(hasPriorPaidPurchase).mockResolvedValue(false);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue(null);

        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({ proofId: "proof-1", idempotencyKey: "k1" });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        await chain.getTransactionStatus(submission.transactionId);

        expect(unlockCampaignVoucher).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                campaignId: "campaign-1",
                consumerUserId: "user-1",
                cafeId: "cafe-target",
            }),
        );
    });

    it("advances the crawl step matching this café", async () => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue(null);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue({
            id: "crawl-1",
            expiresAt: new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(getCrawlSteps).mockResolvedValue([
            { stepIndex: 0, cafeId: "cafe-a" },
            { stepIndex: 1, cafeId: "cafe-target" },
            { stepIndex: 2, cafeId: "cafe-c" },
        ] as never);
        vi.mocked(getOrCreateCrawlProgress).mockResolvedValue({
            id: "progress-1",
            completedCafeIds: ["cafe-a"],
        } as never);

        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({ proofId: "proof-1", idempotencyKey: "k2" });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        await chain.getTransactionStatus(submission.transactionId);

        expect(advanceCrawlProgress).toHaveBeenCalledWith(
            expect.anything(),
            "progress-1",
            ["cafe-a", "cafe-target"],
            false,
        );
        expect(unlockCrawlVoucher).not.toHaveBeenCalled();
    });

    it("unlocks the crawl voucher when the final step completes", async () => {
        vi.mocked(findActiveCampaignForCafe).mockResolvedValue(null);
        vi.mocked(findActiveCrawlForCafe).mockResolvedValue({
            id: "crawl-1",
            expiresAt: new Date(Date.now() + 86_400_000),
        } as never);
        vi.mocked(getCrawlSteps).mockResolvedValue([
            { stepIndex: 0, cafeId: "cafe-a" },
            { stepIndex: 1, cafeId: "cafe-b" },
            { stepIndex: 2, cafeId: "cafe-target" },
        ] as never);
        vi.mocked(getOrCreateCrawlProgress).mockResolvedValue({
            id: "progress-1",
            completedCafeIds: ["cafe-a", "cafe-b"],
        } as never);

        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const submission = await chain.submitConsumption({ proofId: "proof-1", idempotencyKey: "k3" });
        vi.mocked(findTransactionById).mockResolvedValue({
            id: submission.transactionId,
            status: "pending",
            operation: "emission",
            proofId: "proof-1",
            createdAt: new Date(0),
        } as never);
        await chain.getTransactionStatus(submission.transactionId);

        expect(advanceCrawlProgress).toHaveBeenCalledWith(
            expect.anything(),
            "progress-1",
            ["cafe-a", "cafe-b", "cafe-target"],
            true,
        );
        expect(unlockCrawlVoucher).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ crawlId: "crawl-1", consumerUserId: "user-1" }),
        );
    });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/core/consumption/server/__tests__/postgres-mock-chain.test.ts`
Expected: FAIL — repository modules not found, campaign/crawl expectations unmet.

- [ ] **Step 3: Implement the two repository files**

```typescript
// src/core/punch/server/repository/campaigns.ts
import "server-only";
import { and, eq, lte, gte } from "drizzle-orm";
import type { DbClient } from "@/server/drizzle/db";
import { consumerTransaction } from "@/server/drizzle/schemas/consumption-schema";
import {
    campaign,
    consumerVoucher,
    type CampaignRow,
    type ConsumerVoucherRow,
} from "@/server/drizzle/schemas/punch-schema";

export async function findActiveCampaignForCafe(
    client: DbClient,
    cafeId: string,
): Promise<CampaignRow | null> {
    const now = new Date();
    const [row] = await client
        .select()
        .from(campaign)
        .where(
            and(
                eq(campaign.cafeId, cafeId),
                eq(campaign.active, true),
                lte(campaign.windowStart, now),
                gte(campaign.windowEnd, now),
            ),
        );
    return row ?? null;
}

export async function hasPriorPaidPurchase(
    client: DbClient,
    consumerUserId: string,
    cafeId: string,
    excludingTransactionId: string,
): Promise<boolean> {
    const rows = await client
        .select({ id: consumerTransaction.id })
        .from(consumerTransaction)
        .where(
            and(
                eq(consumerTransaction.consumerUserId, consumerUserId),
                eq(consumerTransaction.cafeId, cafeId),
                eq(consumerTransaction.operation, "emission"),
                eq(consumerTransaction.status, "confirmed"),
            ),
        );
    return rows.some((row) => row.id !== excludingTransactionId);
}

/** Idempotent via the (campaignId, consumerUserId) unique index — swallows the conflict. */
export async function unlockCampaignVoucher(
    client: DbClient,
    input: {
        campaignId: string;
        consumerUserId: string;
        cafeId: string;
        expiresAt: Date;
    },
): Promise<ConsumerVoucherRow | null> {
    const [row] = await client
        .insert(consumerVoucher)
        .values({
            source: "campaign",
            campaignId: input.campaignId,
            consumerUserId: input.consumerUserId,
            cafeId: input.cafeId,
            expiresAt: input.expiresAt,
        })
        .onConflictDoNothing({
            target: [consumerVoucher.campaignId, consumerVoucher.consumerUserId],
        })
        .returning();
    return row ?? null;
}
```

```typescript
// src/core/punch/server/repository/crawls.ts
import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import type { DbClient } from "@/server/drizzle/db";
import {
    coffeeCrawl,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerVoucher,
    type CoffeeCrawlRow,
    type CoffeeCrawlStepRow,
    type ConsumerCrawlProgressRow,
    type ConsumerVoucherRow,
} from "@/server/drizzle/schemas/punch-schema";

export async function findActiveCrawlForCafe(
    client: DbClient,
    cafeId: string,
): Promise<CoffeeCrawlRow | null> {
    const now = new Date();
    const [row] = await client
        .select({ crawl: coffeeCrawl })
        .from(coffeeCrawl)
        .innerJoin(coffeeCrawlStep, eq(coffeeCrawlStep.crawlId, coffeeCrawl.id))
        .where(
            and(
                eq(coffeeCrawlStep.cafeId, cafeId),
                eq(coffeeCrawl.active, true),
                gte(coffeeCrawl.expiresAt, now),
            ),
        );
    return row?.crawl ?? null;
}

export async function getCrawlSteps(
    client: DbClient,
    crawlId: string,
): Promise<CoffeeCrawlStepRow[]> {
    return client
        .select()
        .from(coffeeCrawlStep)
        .where(eq(coffeeCrawlStep.crawlId, crawlId))
        .orderBy(asc(coffeeCrawlStep.stepIndex));
}

export async function getOrCreateCrawlProgress(
    client: DbClient,
    crawlId: string,
    consumerUserId: string,
): Promise<ConsumerCrawlProgressRow> {
    const [existing] = await client
        .select()
        .from(consumerCrawlProgress)
        .where(
            and(
                eq(consumerCrawlProgress.crawlId, crawlId),
                eq(consumerCrawlProgress.consumerUserId, consumerUserId),
            ),
        );
    if (existing) return existing;
    const [created] = await client
        .insert(consumerCrawlProgress)
        .values({ crawlId, consumerUserId })
        .onConflictDoNothing()
        .returning();
    if (created) return created;
    const [winner] = await client
        .select()
        .from(consumerCrawlProgress)
        .where(
            and(
                eq(consumerCrawlProgress.crawlId, crawlId),
                eq(consumerCrawlProgress.consumerUserId, consumerUserId),
            ),
        );
    if (!winner) throw new Error("getOrCreateCrawlProgress: lost race with no row");
    return winner;
}

export async function advanceCrawlProgress(
    client: DbClient,
    progressId: string,
    completedCafeIds: string[],
    completed: boolean,
): Promise<ConsumerCrawlProgressRow> {
    const [row] = await client
        .update(consumerCrawlProgress)
        .set({
            completedCafeIds,
            status: completed ? "completed" : "in_progress",
        })
        .where(eq(consumerCrawlProgress.id, progressId))
        .returning();
    if (!row) throw new Error("advanceCrawlProgress: progress row not found");
    return row;
}

export async function unlockCrawlVoucher(
    client: DbClient,
    input: { crawlId: string; consumerUserId: string; expiresAt: Date },
): Promise<ConsumerVoucherRow | null> {
    const [row] = await client
        .insert(consumerVoucher)
        .values({
            source: "crawl",
            crawlId: input.crawlId,
            consumerUserId: input.consumerUserId,
            expiresAt: input.expiresAt,
        })
        .onConflictDoNothing({
            target: [consumerVoucher.crawlId, consumerVoucher.consumerUserId],
        })
        .returning();
    return row ?? null;
}
```

- [ ] **Step 4: Extend emission finalization with campaign and crawl evaluation**

```typescript
// src/core/consumption/server/postgres-mock-chain.ts — extend the transaction body
import { advanceCrawl, type CrawlStepDefinition } from "@/core/punch/domain/crawl";
import { isEligibleForAcquisitionCampaign } from "@/core/punch/domain/campaign";
import {
    findActiveCampaignForCafe,
    hasPriorPaidPurchase,
    unlockCampaignVoucher,
} from "@/core/punch/server/repository/campaigns";
import {
    advanceCrawlProgress,
    findActiveCrawlForCafe,
    getCrawlSteps,
    getOrCreateCrawlProgress,
    unlockCrawlVoucher,
} from "@/core/punch/server/repository/crawls";

// Inside `finalizePendingTransaction`'s emission branch, after
// `await incrementBalance(...)` and before `updateTransactionStatus(...)`:
const activeCampaign = await findActiveCampaignForCafe(tx, proof.cafeId);
if (activeCampaign) {
    const priorPurchase = await hasPriorPaidPurchase(
        tx,
        proof.consumerUserId,
        proof.cafeId,
        row.id,
    );
    const eligible = isEligibleForAcquisitionCampaign({
        campaignCafeId: activeCampaign.cafeId,
        purchaseCafeId: proof.cafeId,
        hadPriorPaidPurchaseAtCafe: priorPurchase,
        purchaseAt: new Date(),
        campaignWindowStart: activeCampaign.windowStart,
        campaignWindowEnd: activeCampaign.windowEnd,
    });
    if (eligible) {
        await unlockCampaignVoucher(tx, {
            campaignId: activeCampaign.id,
            consumerUserId: proof.consumerUserId,
            cafeId: proof.cafeId,
            expiresAt: activeCampaign.windowEnd,
        });
    }
}

const activeCrawl = await findActiveCrawlForCafe(tx, proof.cafeId);
if (activeCrawl) {
    const steps: CrawlStepDefinition[] = (await getCrawlSteps(tx, activeCrawl.id)).map(
        (s) => ({ stepIndex: s.stepIndex, cafeId: s.cafeId }),
    );
    const progress = await getOrCreateCrawlProgress(
        tx,
        activeCrawl.id,
        proof.consumerUserId,
    );
    const advance = advanceCrawl({
        steps,
        completedCafeIds: progress.completedCafeIds,
        purchaseCafeId: proof.cafeId,
        now: new Date(),
        crawlExpiresAt: activeCrawl.expiresAt,
    });
    if (advance.advanced) {
        const nextCompleted = [...progress.completedCafeIds, proof.cafeId];
        await advanceCrawlProgress(
            tx,
            progress.id,
            nextCompleted,
            advance.crawlCompleted,
        );
        if (advance.crawlCompleted) {
            await unlockCrawlVoucher(tx, {
                crawlId: activeCrawl.id,
                consumerUserId: proof.consumerUserId,
                expiresAt: activeCrawl.expiresAt,
            });
        }
    }
}

return { transactionId: row.id, status: row.status };
```

- [ ] **Step 5: Run and confirm pass**

Run: `pnpm vitest run src/core/consumption/server/__tests__/postgres-mock-chain.test.ts` → PASS (11 tests total)

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/core/punch/server/repository/campaigns.ts \
        src/core/punch/server/repository/crawls.ts \
        src/core/consumption/server/postgres-mock-chain.ts \
        src/core/consumption/server/__tests__/postgres-mock-chain.test.ts
git commit -m "feat(punch): unlock campaign and coffee-crawl vouchers atomically on emission"
```

---

### Task 8: PUNCH redemption request lifecycle (atomic burn)

**Files:**
- Create: `src/core/consumption/server/services/request-punch-redemption-service.ts`
- Create: `src/core/consumption/server/services/decide-punch-redemption-service.ts`
- Create: `src/core/consumption/server/api/routes/request-punch-redemption.route.ts`
- Create: `src/core/consumption/server/api/routes/decide-punch-redemption.route.ts`
- Create: `src/core/consumption/server/api/routes/list-cafe-redemption-inbox.route.ts`
- Modify: `src/core/consumption/server/postgres-mock-chain.ts` (implement `submitPunchRedemption`)
- Modify: `src/core/consumption/server/api/router.ts`
- Test: `src/core/consumption/server/services/__tests__/request-punch-redemption-service.test.ts`
- Test: `src/core/consumption/server/services/__tests__/decide-punch-redemption-service.test.ts`
- Test: `src/core/consumption/server/__tests__/postgres-mock-chain.test.ts` (extend)

**Interfaces:**
- Consumes: `canRedeem`, `balanceAfterRedemption` (Task 2, used only for the pre-check in the service; the port re-derives atomically), `createRedemptionRequest`, `findRedemptionRequestById`, `decideRedemptionRequest` (Task 4), `decrementBalance` (Task 4), `getBalance` (Task 4).
- Produces:
```typescript
export async function requestPunchRedemptionService(
    consumerUserId: string,
    cafeId: string,
    input: RequestPunchRedemption,
): AsyncAppResult<RedemptionRequest>;

export async function decidePunchRedemptionService(
    deciderUserId: string,
    cafeId: string,
    requestId: string,
    input: DecideRedemptionRequest,
): AsyncAppResult<{ transactionId: string; status: ConsumerTransactionStatus } | RedemptionRequest>;
```

- [ ] **Step 1: Write the failing request-service test**

```typescript
// src/core/consumption/server/services/__tests__/request-punch-redemption-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/redemption-requests", () => ({
    createRedemptionRequest: vi.fn(),
}));
vi.mock("@/core/cafe/server/repository/find-product-by-id", () => ({
    findProductById: vi.fn(),
}));
vi.mock("@/core/punch/server/repository/balance", () => ({ getBalance: vi.fn() }));

import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { getBalance } from "@/core/punch/server/repository/balance";
import { createRedemptionRequest } from "../../repository/redemption-requests";
import { requestPunchRedemptionService } from "../request-punch-redemption-service";

const rewardProduct = {
    id: "reward-1",
    cafeId: "cafe-1",
    type: "reward" as const,
    approvalStatus: "approved" as const,
    active: true,
};

describe("requestPunchRedemptionService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("blocks a request below 12 PUNCH", async () => {
        vi.mocked(getBalance).mockResolvedValue(11);
        vi.mocked(findProductById).mockResolvedValue(rewardProduct as never);
        const result = await requestPunchRedemptionService("user-1", "cafe-1", {
            productId: "reward-1",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("UNPROCESSABLE_ENTITY");
        expect(createRedemptionRequest).not.toHaveBeenCalled();
    });

    it("creates a pending request at exactly 12 PUNCH", async () => {
        vi.mocked(getBalance).mockResolvedValue(12);
        vi.mocked(findProductById).mockResolvedValue(rewardProduct as never);
        vi.mocked(createRedemptionRequest).mockResolvedValue({
            id: "req-1",
            kind: "punch_reward",
            cafeId: "cafe-1",
            productId: "reward-1",
            voucherId: null,
            status: "pending",
            rejectionReason: null,
            createdAt: new Date(),
        } as never);
        const result = await requestPunchRedemptionService("user-1", "cafe-1", {
            productId: "reward-1",
        });
        expect(result.ok).toBe(true);
        expect(createRedemptionRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "punch_reward",
                consumerUserId: "user-1",
                cafeId: "cafe-1",
                productId: "reward-1",
                status: "pending",
            }),
        );
    });
});
```

- [ ] **Step 2: Run and confirm failure, then implement**

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/request-punch-redemption-service.test.ts` → FAIL

```typescript
// src/core/consumption/server/services/request-punch-redemption-service.ts
import "server-only";
import { findProductById } from "@/core/cafe/server/repository/find-product-by-id";
import { canRedeem } from "@/core/punch/domain/progress";
import { getBalance } from "@/core/punch/server/repository/balance";
import type { RequestPunchRedemption, RedemptionRequest } from "@/core/consumption/domain/types";
import { AppErrors, type AsyncAppResult, err, ok } from "@/server/common/responses";
import { createRedemptionRequest } from "../repository/redemption-requests";
import { toRedemptionRequest } from "../repository/utils";

export async function requestPunchRedemptionService(
    consumerUserId: string,
    cafeId: string,
    input: RequestPunchRedemption,
): AsyncAppResult<RedemptionRequest> {
    const product = await findProductById(input.productId);
    if (!product || product.cafeId !== cafeId) {
        return err(AppErrors.notFound({ targets: ["productId"] }));
    }
    if (product.type !== "reward" || product.approvalStatus !== "approved" || !product.active) {
        return err(AppErrors.unprocessableEntity({ targets: ["productId"] }));
    }
    const balance = await getBalance(consumerUserId);
    if (!canRedeem(balance)) {
        return err(
            AppErrors.unprocessableEntity({
                targets: ["balance"],
                cause: "Necesitas 12 PUNCH para canjear.",
            }),
        );
    }
    const row = await createRedemptionRequest({
        kind: "punch_reward",
        consumerUserId,
        cafeId,
        productId: input.productId,
        voucherId: null,
        status: "pending",
        rejectionReason: null,
        decidedByUserId: null,
    });
    return ok(toRedemptionRequest(row));
}
```

```typescript
// src/core/consumption/server/repository/utils.ts
import "server-only";
import type { RedemptionRequest } from "@/core/consumption/domain/types";
import type { RedemptionRequestRow } from "@/server/drizzle/schemas/consumption-schema";

export function toRedemptionRequest(row: RedemptionRequestRow): RedemptionRequest {
    return {
        id: row.id,
        kind: row.kind,
        cafeId: row.cafeId,
        productId: row.productId,
        voucherId: row.voucherId,
        status: row.status,
        rejectionReason: row.rejectionReason,
        createdAt: row.createdAt.toISOString(),
    };
}
```

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/request-punch-redemption-service.test.ts` → PASS (2 tests)

- [ ] **Step 3: Extend `postgres-mock-chain.test.ts` and implement `submitPunchRedemption`**

```typescript
// append to postgres-mock-chain.test.ts
describe("PostgresMockConsumerChain.submitPunchRedemption", () => {
    beforeEach(() => vi.clearAllMocks());

    it("throws REQUEST_NOT_APPROVED for a pending request", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        const { findRedemptionRequestById } = await import(
            "../repository/redemption-requests"
        );
        vi.mocked(findRedemptionRequestById).mockResolvedValue({
            id: "req-1",
            status: "pending",
            consumerUserId: "user-1",
            cafeId: "cafe-1",
        } as never);
        const chain = new PostgresMockConsumerChain();
        await expect(
            chain.submitPunchRedemption({
                redemptionRequestId: "req-1",
                idempotencyKey: "k1",
            }),
        ).rejects.toMatchObject({ code: "REQUEST_NOT_APPROVED" });
    });

    it("burns exactly 12 PUNCH on an approved request", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        const { findRedemptionRequestById } = await import(
            "../repository/redemption-requests"
        );
        vi.mocked(findRedemptionRequestById).mockResolvedValue({
            id: "req-1",
            status: "approved",
            consumerUserId: "user-1",
            cafeId: "cafe-1",
        } as never);
        vi.mocked(findTransactionByRedemptionRequestId).mockResolvedValue(null);
        vi.mocked(createTransaction).mockResolvedValue({
            id: "tx-burn",
            status: "pending",
        } as never);
        const { decrementBalance } = await import(
            "@/core/punch/server/repository/balance"
        );
        const chain = new PostgresMockConsumerChain(() => Date.now(), 0);
        const result = await chain.submitPunchRedemption({
            redemptionRequestId: "req-1",
            idempotencyKey: "k2",
        });
        expect(result).toEqual({ transactionId: "tx-burn", status: "pending" });
        expect(decrementBalance).not.toHaveBeenCalled();
    });
});
```

Add `vi.mock("../repository/redemption-requests", () => ({ findRedemptionRequestById: vi.fn() }))` near the top with the other mocks (extend the block if it already exists from Task 4).

```typescript
// src/core/consumption/server/postgres-mock-chain.ts — replace the submitPunchRedemption stub
import { decrementBalance } from "@/core/punch/server/repository/balance";
import { findRedemptionRequestById } from "./repository/redemption-requests";
import { findTransactionByRedemptionRequestId } from "./repository/transactions";
import { PUNCH_REDEMPTION_COST } from "@/core/punch/domain/progress";

async submitPunchRedemption(input: {
    redemptionRequestId: string;
    idempotencyKey: string;
}): Promise<ChainSubmission> {
    const existing = await findTransactionByIdempotencyKey(input.idempotencyKey);
    if (existing) return { transactionId: existing.id, status: existing.status };

    return db.transaction(async (tx) => {
        const request = await findRedemptionRequestById(input.redemptionRequestId, tx);
        if (!request) throw new ConsumerChainError("REQUEST_NOT_FOUND");
        if (request.status !== "approved") {
            throw new ConsumerChainError("REQUEST_NOT_APPROVED");
        }
        const already = await findTransactionByRedemptionRequestId(tx, request.id);
        if (already) return { transactionId: already.id, status: already.status };

        const row = await createTransaction(tx, {
            operation: "punch_redemption",
            consumerUserId: request.consumerUserId,
            cafeId: request.cafeId,
            redemptionRequestId: request.id,
            chainTxId: `mock_${crypto.randomUUID()}`,
            status: "pending",
            idempotencyKey: input.idempotencyKey,
        });
        return { transactionId: row.id, status: row.status };
    });
}
```

Extend `finalizePendingTransaction` with `punch_redemption`: load approved request inside same transaction, call `decrementBalance(tx, consumerUserId, 12)`, then `updateTransactionStatus(tx, id, "confirmed")`. Add poll test proving submit leaves balance untouched, first terminal poll subtracts exactly 12, second poll subtracts nothing, and insufficient balance throws/rolls back while transaction becomes `rejected` with “Necesitas 12 PUNCH para canjear.”

Run: `pnpm vitest run src/core/consumption/server/__tests__/postgres-mock-chain.test.ts` → PASS (16 tests total)

- [ ] **Step 4: Write the failing decision-service test, then implement**

```typescript
// src/core/consumption/server/services/__tests__/decide-punch-redemption-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/redemption-requests", () => ({
    decideRedemptionRequest: vi.fn(),
}));
vi.mock(
    "@/server/auth/membership/require-cafe-role",
    async (importOriginal) => {
        const actual =
            await importOriginal<
                typeof import("@/server/auth/membership/require-cafe-role")
            >();
        return { ...actual, requireCafeRole: vi.fn() };
    },
);
vi.mock("../../postgres-mock-chain", () => ({
    PostgresMockConsumerChain: vi.fn().mockImplementation(() => ({
        submitPunchRedemption: vi.fn().mockResolvedValue({
            transactionId: "tx-1",
            status: "pending",
        }),
    })),
}));

import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { ok as okResult } from "@/server/common/responses";
import { decideRedemptionRequest } from "../../repository/redemption-requests";
import { decidePunchRedemptionService } from "../decide-punch-redemption-service";

const membership = {
    id: "m1",
    userId: "barista-1",
    cafeId: "cafe-1",
    role: "barista" as const,
    createdAt: new Date(),
};

describe("decidePunchRedemptionService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("submits through the chain port on approval", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(decideRedemptionRequest).mockResolvedValue({
            id: "req-1",
            status: "approved",
        } as never);
        const result = await decidePunchRedemptionService(
            "barista-1",
            "cafe-1",
            "req-1",
            { decision: "approved" },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ transactionId: "tx-1", status: "pending" });
        }
    });

    it("rejects with a reason and does not touch the chain port", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(decideRedemptionRequest).mockResolvedValue({
            id: "req-1",
            status: "rejected",
        } as never);
        const result = await decidePunchRedemptionService(
            "barista-1",
            "cafe-1",
            "req-1",
            { decision: "rejected", rejectionReason: "Sin stock" },
        );
        expect(result.ok).toBe(true);
        expect(decideRedemptionRequest).toHaveBeenCalledWith(
            "req-1",
            "barista-1",
            "rejected",
            "Sin stock",
        );
    });
});
```

```typescript
// src/core/consumption/server/services/decide-punch-redemption-service.ts
import "server-only";
import type { DecideRedemptionRequest } from "@/core/consumption/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { AppErrors, type AsyncAppResult, err, ok } from "@/server/common/responses";
import { decideRedemptionRequest } from "../repository/redemption-requests";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import type { ChainSubmission } from "../chain-port";

export async function decidePunchRedemptionService(
    deciderUserId: string,
    cafeId: string,
    requestId: string,
    input: DecideRedemptionRequest,
): AsyncAppResult<ChainSubmission | { requestId: string; status: "rejected" }> {
    const membershipResult = await requireCafeRole(deciderUserId, cafeId, [
        "owner",
        "barista",
    ]);
    if (!membershipResult.ok) return err(membershipResult.error);

    const request = await decideRedemptionRequest(
        requestId,
        deciderUserId,
        input.decision,
        input.rejectionReason ?? null,
    );

    if (request.status === "rejected") {
        return ok({ requestId: request.id, status: "rejected" });
    }

    try {
        const submission = await new PostgresMockConsumerChain().submitPunchRedemption({
            redemptionRequestId: request.id,
            idempotencyKey: `punch_redemption:${request.id}`,
        });
        return ok(submission);
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
```

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/decide-punch-redemption-service.test.ts` → PASS (2 tests)

- [ ] **Step 5: Add routes, register on router**

```typescript
// src/core/consumption/server/api/routes/request-punch-redemption.route.ts
import { Elysia, t } from "elysia";
import { requestPunchRedemptionSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { requestPunchRedemptionService } from "../../services/request-punch-redemption-service";

export const requestPunchRedemptionRoute = new Elysia().use(authed).post(
    "/:cafeId/punch-redemptions",
    async ({ user, params, body, status }) => {
        const result = await requestPunchRedemptionService(user.id, params.cafeId, body);
        if (!result.ok) return status(result.error.status as 500, errorToResponse(result.error));
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String() }),
        body: requestPunchRedemptionSchema,
        response: {
            201: t.Object({
                status: t.Literal(201),
                response: t.Object({
                    id: t.String(),
                    kind: t.String(),
                    status: t.String(),
                }),
            }),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
        },
        detail: { tags: ["Consumption"], summary: "Request a PUNCH reward redemption" },
    },
);
```

```typescript
// src/core/consumption/server/api/routes/decide-punch-redemption.route.ts
import { Elysia, t } from "elysia";
import { decideRedemptionRequestSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { decidePunchRedemptionService } from "../../services/decide-punch-redemption-service";

export const decidePunchRedemptionRoute = new Elysia().use(authed).post(
    "/:cafeId/punch-redemptions/:requestId/decide",
    async ({ user, params, body, status }) => {
        const result = await decidePunchRedemptionService(
            user.id,
            params.cafeId,
            params.requestId,
            body,
        );
        if (!result.ok) return status(result.error.status as 500, errorToResponse(result.error));
        return status(200, CommonResponse.successful({ response: result.data }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String(), requestId: t.String() }),
        body: decideRedemptionRequestSchema,
        response: {
            200: t.Object({ status: t.Literal(200), response: t.Any() }),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
        },
        detail: { tags: ["Consumption"], summary: "Approve or reject a PUNCH redemption" },
    },
);
```

```typescript
// src/core/consumption/server/api/routes/list-cafe-redemption-inbox.route.ts
import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { listPendingRequestsForCafe } from "../../repository/redemption-requests";
import { toRedemptionRequest } from "../../repository/utils";

export const listCafeRedemptionInboxRoute = new Elysia().use(authed).get(
    "/:cafeId/redemption-inbox",
    async ({ user, params, status }) => {
        const membershipResult = await requireCafeRole(user.id, params.cafeId, [
            "owner",
            "barista",
        ]);
        if (!membershipResult.ok) {
            return status(
                membershipResult.error.status as 403,
                errorToResponse(membershipResult.error),
            );
        }
        const rows = await listPendingRequestsForCafe(params.cafeId);
        return status(200, CommonResponse.successful({ response: rows.map(toRedemptionRequest) }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String() }),
        response: {
            200: t.Object({ status: t.Literal(200), response: t.Array(t.Any()) }),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
        },
        detail: { tags: ["Consumption"], summary: "List a café's pending fulfillment inbox" },
    },
);
```

```typescript
// src/core/consumption/server/api/router.ts (replace)
import { Elysia } from "elysia";
import { confirmPurchaseRoute } from "./routes/confirm-purchase.route";
import { createPurchaseProofRoute } from "./routes/create-purchase-proof.route";
import { decidePunchRedemptionRoute } from "./routes/decide-punch-redemption.route";
import { getPurchaseProofRoute } from "./routes/get-purchase-proof.route";
import { getTransactionRoute } from "./routes/get-transaction.route";
import { listCafeRedemptionInboxRoute } from "./routes/list-cafe-redemption-inbox.route";
import { requestPunchRedemptionRoute } from "./routes/request-punch-redemption.route";

export const consumptionRouter = new Elysia({ prefix: "/consumption" })
    .use(createPurchaseProofRoute)
    .use(getPurchaseProofRoute)
    .use(confirmPurchaseRoute)
    .use(getTransactionRoute)
    .use(requestPunchRedemptionRoute)
    .use(decidePunchRedemptionRoute)
    .use(listCafeRedemptionInboxRoute);
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/core/consumption/server
git commit -m "feat(consumption): PUNCH redemption request lifecycle with atomic burn"
```

---

### Task 9: Voucher fulfillment lifecycle (campaign/crawl vouchers, no PUNCH change)

**Files:**
- Create: `src/core/punch/server/repository/vouchers.ts`
- Create: `src/core/consumption/server/services/request-voucher-redemption-service.ts`
- Create: `src/core/consumption/server/services/decide-voucher-redemption-service.ts`
- Create: `src/core/consumption/server/api/routes/request-voucher-redemption.route.ts`
- Create: `src/core/consumption/server/api/routes/decide-voucher-redemption.route.ts`
- Modify: `src/core/consumption/server/postgres-mock-chain.ts` (implement `submitVoucherRedemption`)
- Modify: `src/core/consumption/server/api/router.ts`
- Test: `src/core/consumption/server/services/__tests__/request-voucher-redemption-service.test.ts`
- Test: `src/core/consumption/server/services/__tests__/decide-voucher-redemption-service.test.ts`
- Test: `src/core/consumption/server/__tests__/postgres-mock-chain.test.ts` (extend)

**Interfaces:**
- Consumes: `createRedemptionRequest` (Task 4), `canTransitionFulfillment` (Task 1).
- Produces: `vouchers.ts` — `findVoucherById(client, id)`, `markVoucherRedeemed(client, id)` (only succeeds when `status = 'available'`); `requestVoucherRedemptionService(consumerUserId, cafeId, input: RequestVoucherRedemption)`; `decideVoucherRedemptionService(deciderUserId, cafeId, requestId, input: DecideRedemptionRequest)`.

- [ ] **Step 1: Implement `vouchers.ts`; exercise it through adapter contract tests in Step 4**

```typescript
// src/core/punch/server/repository/vouchers.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type DbClient } from "@/server/drizzle/db";
import {
    consumerVoucher,
    type ConsumerVoucherRow,
} from "@/server/drizzle/schemas/punch-schema";

export async function findVoucherById(
    id: string,
    client: DbClient = db,
): Promise<ConsumerVoucherRow | null> {
    const [row] = await client
        .select()
        .from(consumerVoucher)
        .where(eq(consumerVoucher.id, id));
    return row ?? null;
}

/** Only succeeds when the voucher is still available — enforces "redeemed exactly once." */
export async function markVoucherRedeemed(
    client: DbClient,
    id: string,
): Promise<ConsumerVoucherRow> {
    const [row] = await client
        .update(consumerVoucher)
        .set({ status: "redeemed", redeemedAt: new Date() })
        .where(and(eq(consumerVoucher.id, id), eq(consumerVoucher.status, "available")))
        .returning();
    if (!row) throw new Error("markVoucherRedeemed: voucher not available");
    return row;
}
```

- [ ] **Step 2: Write the failing request-service test**

```typescript
// src/core/consumption/server/services/__tests__/request-voucher-redemption-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/redemption-requests", () => ({
    createRedemptionRequest: vi.fn(),
}));
vi.mock("@/core/punch/server/repository/vouchers", () => ({
    findVoucherById: vi.fn(),
}));

import { findVoucherById } from "@/core/punch/server/repository/vouchers";
import { createRedemptionRequest } from "../../repository/redemption-requests";
import { requestVoucherRedemptionService } from "../request-voucher-redemption-service";

describe("requestVoucherRedemptionService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("rejects a voucher that is not available", async () => {
        vi.mocked(findVoucherById).mockResolvedValue({
            id: "v1",
            status: "redeemed",
            consumerUserId: "user-1",
        } as never);
        const result = await requestVoucherRedemptionService("user-1", "cafe-1", {
            voucherId: "v1",
        });
        expect(result.ok).toBe(false);
    });

    it("creates a pending voucher fulfillment request", async () => {
        vi.mocked(findVoucherById).mockResolvedValue({
            id: "v1",
            status: "available",
            consumerUserId: "user-1",
        } as never);
        vi.mocked(createRedemptionRequest).mockResolvedValue({
            id: "req-1",
            kind: "voucher",
            cafeId: "cafe-1",
            productId: null,
            voucherId: "v1",
            status: "pending",
            rejectionReason: null,
            createdAt: new Date(),
        } as never);
        const result = await requestVoucherRedemptionService("user-1", "cafe-1", {
            voucherId: "v1",
        });
        expect(result.ok).toBe(true);
        expect(createRedemptionRequest).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "voucher", voucherId: "v1" }),
        );
    });
});
```

- [ ] **Step 3: Run and confirm failure, then implement**

```typescript
// src/core/consumption/server/services/request-voucher-redemption-service.ts
import "server-only";
import type { RedemptionRequest, RequestVoucherRedemption } from "@/core/consumption/domain/types";
import { findVoucherById } from "@/core/punch/server/repository/vouchers";
import { AppErrors, type AsyncAppResult, err, ok } from "@/server/common/responses";
import { createRedemptionRequest } from "../repository/redemption-requests";
import { toRedemptionRequest } from "../repository/utils";

export async function requestVoucherRedemptionService(
    consumerUserId: string,
    cafeId: string,
    input: RequestVoucherRedemption,
): AsyncAppResult<RedemptionRequest> {
    const voucher = await findVoucherById(input.voucherId);
    if (!voucher || voucher.consumerUserId !== consumerUserId) {
        return err(AppErrors.notFound({ targets: ["voucherId"] }));
    }
    if (voucher.status !== "available") {
        return err(AppErrors.unprocessableEntity({ targets: ["voucherId"] }));
    }
    const row = await createRedemptionRequest({
        kind: "voucher",
        consumerUserId,
        cafeId,
        productId: null,
        voucherId: input.voucherId,
        status: "pending",
        rejectionReason: null,
        decidedByUserId: null,
    });
    return ok(toRedemptionRequest(row));
}
```

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/request-voucher-redemption-service.test.ts` → PASS (2 tests)

- [ ] **Step 4: Extend `postgres-mock-chain.test.ts`, implement `submitVoucherRedemption`**

```typescript
// append to postgres-mock-chain.test.ts
describe("PostgresMockConsumerChain.submitVoucherRedemption", () => {
    beforeEach(() => vi.clearAllMocks());

    it("creates pending voucher tx without changing voucher or PUNCH", async () => {
        vi.mocked(findTransactionByIdempotencyKey).mockResolvedValue(null);
        const { findRedemptionRequestById } = await import(
            "../repository/redemption-requests"
        );
        vi.mocked(findRedemptionRequestById).mockResolvedValue({
            id: "req-1",
            status: "approved",
            consumerUserId: "user-1",
            cafeId: "cafe-1",
            voucherId: "v1",
        } as never);
        vi.mocked(findTransactionByRedemptionRequestId).mockResolvedValue(null);
        vi.mocked(createTransaction).mockResolvedValue({
            id: "tx-voucher",
            status: "pending",
        } as never);
        const { markVoucherRedeemed } = await import(
            "@/core/punch/server/repository/vouchers"
        );
        const { decrementBalance } = await import(
            "@/core/punch/server/repository/balance"
        );
        const chain = new PostgresMockConsumerChain();
        const result = await chain.submitVoucherRedemption({
            redemptionRequestId: "req-1",
            idempotencyKey: "k1",
        });
        expect(result).toEqual({ transactionId: "tx-voucher", status: "pending" });
        expect(markVoucherRedeemed).not.toHaveBeenCalled();
        expect(decrementBalance).not.toHaveBeenCalled();
    });
});
```

Add `vi.mock("@/core/punch/server/repository/vouchers", () => ({ markVoucherRedeemed: vi.fn() }))` to the top mocks.

```typescript
// src/core/consumption/server/postgres-mock-chain.ts — replace the submitVoucherRedemption stub
import { markVoucherRedeemed } from "@/core/punch/server/repository/vouchers";

async submitVoucherRedemption(input: {
    redemptionRequestId: string;
    idempotencyKey: string;
}): Promise<ChainSubmission> {
    const existing = await findTransactionByIdempotencyKey(input.idempotencyKey);
    if (existing) return { transactionId: existing.id, status: existing.status };

    return db.transaction(async (tx) => {
        const request = await findRedemptionRequestById(input.redemptionRequestId, tx);
        if (!request) throw new ConsumerChainError("REQUEST_NOT_FOUND");
        if (request.status !== "approved") {
            throw new ConsumerChainError("REQUEST_NOT_APPROVED");
        }
        const already = await findTransactionByRedemptionRequestId(tx, request.id);
        if (already) return { transactionId: already.id, status: already.status };

        const row = await createTransaction(tx, {
            operation: "voucher_redemption",
            consumerUserId: request.consumerUserId,
            cafeId: request.cafeId,
            redemptionRequestId: request.id,
            chainTxId: `mock_${crypto.randomUUID()}`,
            status: "pending",
            idempotencyKey: input.idempotencyKey,
        });
        return { transactionId: row.id, status: row.status };
    });
}
```

Extend `finalizePendingTransaction` with `voucher_redemption`: load approved request, require non-null voucher ID, call `markVoucherRedeemed(tx, voucherId)`, then confirm transaction. Add poll test proving submit changes neither voucher nor PUNCH, first terminal poll redeems voucher once, second poll is a no-op, and PUNCH balance repository is never called.

Run: `pnpm vitest run src/core/consumption/server/__tests__/postgres-mock-chain.test.ts` → PASS (19 tests total)

- [ ] **Step 5: Write failing voucher-decision test, then implement**

Test `decideVoucherRedemptionService` with mocked `requireCafeRole`, `decideRedemptionRequest`, and port: approval returns pending `ChainSubmission`; rejection with “Voucher no disponible” returns rejected request and never calls port; outsider returns 403 and never writes. Run test first and expect module-not-found failure.

```typescript
// src/core/consumption/server/services/decide-voucher-redemption-service.ts
import "server-only";
import type { DecideRedemptionRequest } from "@/core/consumption/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { AppErrors, type AsyncAppResult, err, ok } from "@/server/common/responses";
import { decideRedemptionRequest } from "../repository/redemption-requests";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import type { ChainSubmission } from "../chain-port";

export async function decideVoucherRedemptionService(
    deciderUserId: string,
    cafeId: string,
    requestId: string,
    input: DecideRedemptionRequest,
): AsyncAppResult<ChainSubmission | { requestId: string; status: "rejected" }> {
    const membershipResult = await requireCafeRole(deciderUserId, cafeId, [
        "owner",
        "barista",
    ]);
    if (!membershipResult.ok) return err(membershipResult.error);

    const request = await decideRedemptionRequest(
        requestId,
        deciderUserId,
        input.decision,
        input.rejectionReason ?? null,
    );

    if (request.status === "rejected") {
        return ok({ requestId: request.id, status: "rejected" });
    }

    try {
        const submission = await new PostgresMockConsumerChain().submitVoucherRedemption({
            redemptionRequestId: request.id,
            idempotencyKey: `voucher_redemption:${request.id}`,
        });
        return ok(submission);
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
```

- [ ] **Step 6: Add concrete voucher routes and register them**

```typescript
// src/core/consumption/server/api/routes/request-voucher-redemption.route.ts
import { Elysia, t } from "elysia";
import { requestVoucherRedemptionSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { requestVoucherRedemptionService } from "../../services/request-voucher-redemption-service";

export const requestVoucherRedemptionRoute = new Elysia().use(authed).post(
    "/:cafeId/voucher-redemptions",
    async ({ user, params, body, status }) => {
        const result = await requestVoucherRedemptionService(user.id, params.cafeId, body);
        if (!result.ok) return status(result.error.status as 500, errorToResponse(result.error));
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String() }),
        body: requestVoucherRedemptionSchema,
        response: {
            201: t.Object({
                status: t.Literal(201),
                response: t.Object({ id: t.String(), kind: t.String(), status: t.String() }),
            }),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
        },
        detail: { tags: ["Consumption"], summary: "Request a voucher fulfillment" },
    },
);
```

```typescript
// src/core/consumption/server/api/routes/decide-voucher-redemption.route.ts
import { Elysia, t } from "elysia";
import { decideRedemptionRequestSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { decideVoucherRedemptionService } from "../../services/decide-voucher-redemption-service";

export const decideVoucherRedemptionRoute = new Elysia().use(authed).post(
    "/:cafeId/voucher-redemptions/:requestId/decide",
    async ({ user, params, body, status }) => {
        const result = await decideVoucherRedemptionService(
            user.id,
            params.cafeId,
            params.requestId,
            body,
        );
        if (!result.ok) return status(result.error.status as 500, errorToResponse(result.error));
        return status(200, CommonResponse.successful({ response: result.data }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String(), requestId: t.String() }),
        body: decideRedemptionRequestSchema,
        response: {
            200: t.Object({ status: t.Literal(200), response: t.Any() }),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
        },
        detail: { tags: ["Consumption"], summary: "Approve or reject a voucher fulfillment" },
    },
);
```

Add `requestVoucherRedemptionSchema` to `src/core/consumption/domain/schemas.ts` if not already present from Task 1 Step 10 (it is — confirm the export exists before wiring the route).

```typescript
// src/core/consumption/server/api/router.ts (final version — replace)
import { Elysia } from "elysia";
import { confirmPurchaseRoute } from "./routes/confirm-purchase.route";
import { createPurchaseProofRoute } from "./routes/create-purchase-proof.route";
import { decidePunchRedemptionRoute } from "./routes/decide-punch-redemption.route";
import { decideVoucherRedemptionRoute } from "./routes/decide-voucher-redemption.route";
import { getPurchaseProofRoute } from "./routes/get-purchase-proof.route";
import { getTransactionRoute } from "./routes/get-transaction.route";
import { listCafeRedemptionInboxRoute } from "./routes/list-cafe-redemption-inbox.route";
import { requestPunchRedemptionRoute } from "./routes/request-punch-redemption.route";
import { requestVoucherRedemptionRoute } from "./routes/request-voucher-redemption.route";

export const consumptionRouter = new Elysia({ prefix: "/consumption" })
    .use(createPurchaseProofRoute)
    .use(getPurchaseProofRoute)
    .use(confirmPurchaseRoute)
    .use(getTransactionRoute)
    .use(requestPunchRedemptionRoute)
    .use(decidePunchRedemptionRoute)
    .use(requestVoucherRedemptionRoute)
    .use(decideVoucherRedemptionRoute)
    .use(listCafeRedemptionInboxRoute);
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/core/punch/server/repository/vouchers.ts src/core/consumption/server
git commit -m "feat(consumption): voucher fulfillment lifecycle without PUNCH mutation"
```

---

### Task 10: Punch router, dashboard aggregate, Eden client hooks

**Files:**
- Create: `src/core/punch/server/services/get-dashboard-service.ts`
- Create: `src/core/punch/server/services/list-campaigns-service.ts`
- Create: `src/core/punch/server/services/list-crawls-service.ts`
- Create: `src/core/punch/server/api/routes/get-dashboard.route.ts`
- Create: `src/core/punch/server/api/routes/list-campaigns.route.ts`
- Create: `src/core/punch/server/api/routes/get-campaign.route.ts`
- Create: `src/core/punch/server/api/routes/list-crawls.route.ts`
- Create: `src/core/punch/server/api/routes/get-crawl.route.ts`
- Create: `src/core/punch/server/api/routes/list-vouchers.route.ts`
- Create: `src/core/punch/server/api/router.ts`
- Create: `src/core/consumption/client/hooks.ts`
- Create: `src/core/punch/client/hooks.ts`
- Modify: `src/server/router.ts` (register both routers)
- Test: `src/core/punch/server/services/__tests__/get-dashboard-service.test.ts`

**Interfaces:**
- Consumes: `getBalance` (Task 4), `progressFraction` (Task 2), `findActiveCampaignForCafe` (Task 7 — reused read-only), crawl progress repository (Task 7).
- Produces: `getDashboardService(userId): AsyncAppResult<Dashboard>`; Eden hooks `useCreatePurchaseProof(cafeId)`, `usePurchaseProof(proofId)`, `useConfirmPurchase()`, `useTransactionStatus(transactionId)`, `useRequestPunchRedemption(cafeId)`, `useDecidePunchRedemption(cafeId)`, `useRequestVoucherRedemption(cafeId)`, `useDecideVoucherRedemption(cafeId)`, `useCafeRedemptionInbox(cafeId)`, `useDashboard()`, `useCampaigns()`, `useCampaign(id)`, `useCrawls()`, `useCrawl(id)`, `useVouchers()`.

- [ ] **Step 1: Write the failing dashboard-service test**

```typescript
// src/core/punch/server/services/__tests__/get-dashboard-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/balance", () => ({ getBalance: vi.fn() }));
vi.mock("../../repository/campaigns", () => ({ findActiveCampaignForCafe: vi.fn() }));
vi.mock("../../repository/crawls", () => ({
    findActiveCrawlForCafe: vi.fn(),
    getCrawlSteps: vi.fn(),
    getOrCreateCrawlProgress: vi.fn(),
}));

import { getBalance } from "../../repository/balance";
import { getDashboardService } from "../get-dashboard-service";

describe("getDashboardService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("caps the progress numerator at 12", async () => {
        vi.mocked(getBalance).mockResolvedValue(14);
        const result = await getDashboardService("user-1");
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.progress).toEqual({ numerator: 12, denominator: 12 });
            expect(result.data.balance).toBe(14);
        }
    });
});
```

- [ ] **Step 2: Run and confirm failure, then implement**

```typescript
// src/core/punch/server/services/get-dashboard-service.ts
import "server-only";
import { progressFraction } from "@/core/punch/domain/progress";
import type { Dashboard } from "@/core/punch/domain/types";
import { AppErrors, type AsyncAppResult, ok } from "@/server/common/responses";
import { getBalance } from "../repository/balance";

export async function getDashboardService(userId: string): AsyncAppResult<Dashboard> {
    const balance = await getBalance(userId);
    return ok({
        balance,
        progress: progressFraction(balance),
        activeCampaign: null,
        activeCrawl: null,
    });
}
```

Run: `pnpm vitest run src/core/punch/server/services/__tests__/get-dashboard-service.test.ts` → PASS (1 test)

Note: `activeCampaign`/`activeCrawl` start `null` here to keep this step focused; extend the service in the same task (before commit) to populate them by calling `findActiveCampaignForCafe`/`findActiveCrawlForCafe` per café the consumer has an unredeemed voucher or in-progress crawl for — read straight from `punch/server/repository/campaigns.ts` and `crawls.ts` built in Task 7 (pass `db` directly as the `client` argument since dashboard reads don't need transactional isolation).

- [ ] **Step 3: Add `list-campaigns-service.ts` and `list-crawls-service.ts` (thin list wrappers, no dedicated test — same convention as `src/core/cafe/server/services/list-cafes-service.ts`)**

```typescript
// src/core/punch/server/services/list-campaigns-service.ts
import "server-only";
import { db } from "@/server/drizzle/db";
import { campaign } from "@/server/drizzle/schemas/punch-schema";
import { eq } from "drizzle-orm";
import { AsyncAppResult, ok } from "@/server/common/responses";
import type { Campaign } from "@/core/punch/domain/types";

export async function listCampaignsService(): AsyncAppResult<Campaign[]> {
    const rows = await db.select().from(campaign).where(eq(campaign.active, true));
    return ok(
        rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            cafeId: row.cafeId,
            name: row.name,
            windowStart: row.windowStart.toISOString(),
            windowEnd: row.windowEnd.toISOString(),
            active: row.active,
        })),
    );
}
```

```typescript
// src/core/punch/server/services/list-crawls-service.ts
import "server-only";
import { db } from "@/server/drizzle/db";
import { asc, eq } from "drizzle-orm";
import { coffeeCrawl, coffeeCrawlStep } from "@/server/drizzle/schemas/punch-schema";
import { AsyncAppResult, ok } from "@/server/common/responses";
import type { CoffeeCrawl } from "@/core/punch/domain/types";

export async function listCrawlsService(): AsyncAppResult<CoffeeCrawl[]> {
    const crawls = await db.select().from(coffeeCrawl).where(eq(coffeeCrawl.active, true));
    const result: CoffeeCrawl[] = [];
    for (const c of crawls) {
        const steps = await db
            .select()
            .from(coffeeCrawlStep)
            .where(eq(coffeeCrawlStep.crawlId, c.id))
            .orderBy(asc(coffeeCrawlStep.stepIndex));
        result.push({
            id: c.id,
            name: c.name,
            expiresAt: c.expiresAt.toISOString(),
            steps: steps.map((s) => ({ stepIndex: s.stepIndex, cafeId: s.cafeId })),
        });
    }
    return ok(result);
}
```

- [ ] **Step 4: Add punch routes and router**

```typescript
// src/core/punch/server/api/routes/get-dashboard.route.ts
import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { getDashboardService } from "../../services/get-dashboard-service";

export const getDashboardRoute = new Elysia().use(authed).get(
    "/dashboard",
    async ({ user, status }) => {
        const result = await getDashboardService(user.id);
        if (!result.ok) return status(result.error.status as 500, errorToResponse(result.error));
        return status(200, CommonResponse.successful({ response: result.data }));
    },
    {
        authed: true,
        response: {
            200: t.Object({ status: t.Literal(200), response: t.Any() }),
            401: errorResponseSchema(401),
        },
        detail: { tags: ["Punch"], summary: "Get the consumer dashboard" },
    },
);
```

Add five explicit authenticated GET routes with these exact contracts:

| File | Method/path | Service call | Success | Miss/error |
|---|---|---|---|---|
| `list-campaigns.route.ts` | `GET /campaigns` | `listCampaignsService()` | `200` + `Campaign[]` | `401` |
| `get-campaign.route.ts` | `GET /campaigns/:id` | `getCampaignService(id)` | `200` + `Campaign` | `404` when absent |
| `list-crawls.route.ts` | `GET /crawls` | `listCrawlsService()` | `200` + `CoffeeCrawl[]` | `401` |
| `get-crawl.route.ts` | `GET /crawls/:id` | `getCrawlService(id)` | `200` + `CoffeeCrawl` | `404` when absent |
| `list-vouchers.route.ts` | `GET /vouchers` | `listVouchersService(user.id)` | `200` + only that user's `ConsumerVoucher[]` | `401` |

Each file must declare `authed: true`, concrete `params` where present, `successResponseSchema(...)` using the matching domain schema, and `errorResponseSchema` for every listed error. `getCampaignService` queries `campaign.id`; `getCrawlService` queries one crawl plus ordered steps; `listVouchersService` filters by `consumerUserId` and derives `expired` from server time before mapping. Add focused service tests proving single-entity `404` behavior and cross-user voucher isolation before implementing these services.

```typescript
// src/core/punch/server/api/router.ts
import { Elysia } from "elysia";
import { getCampaignRoute } from "./routes/get-campaign.route";
import { getCrawlRoute } from "./routes/get-crawl.route";
import { getDashboardRoute } from "./routes/get-dashboard.route";
import { listCampaignsRoute } from "./routes/list-campaigns.route";
import { listCrawlsRoute } from "./routes/list-crawls.route";
import { listVouchersRoute } from "./routes/list-vouchers.route";

export const punchRouter = new Elysia({ prefix: "/punch" })
    .use(getDashboardRoute)
    .use(listCampaignsRoute)
    .use(getCampaignRoute)
    .use(listCrawlsRoute)
    .use(getCrawlRoute)
    .use(listVouchersRoute);
```

- [ ] **Step 5: Register both routers on the app**

```typescript
// src/server/router.ts (modify the existing chain)
import { consumptionRouter } from "@/core/consumption/server/api/router";
import { punchRouter } from "@/core/punch/server/api/router";
// ...keep existing imports...

const app = new Elysia({ prefix: "/api/v1" })
    // ...unchanged up through .use(elysiaLogger())...
    .use(projectRouter)
    .use(cafeRouter)
    .use(consumptionRouter)
    .use(punchRouter);
```

- [ ] **Step 6: Add Eden client hooks**

```typescript
// src/core/consumption/client/hooks.ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useElysia } from "@/frontend/lib/eden";

const unwrapResponse = (result: unknown) => (result as { response: unknown }).response;
const showError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : "Ocurrió un error inesperado");
const withErrorToast = <T extends object>(options: T) =>
    ({ ...options, onError: showError }) as T;

export const useCreatePurchaseProof = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client({ cafeId })["purchase-proofs"].post.mutationOptions(),
            onSuccess: () =>
                queryClient.invalidateQueries({ queryKey: ["consumption", "proofs"] }),
        }),
    );
};

export const usePurchaseProof = (proofId: string) => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client["purchase-proofs"]({ proofId }).get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["consumption", "proofs", proofId],
        select: unwrapResponse,
        refetchInterval: 3000,
    });
};

export const useConfirmPurchase = () => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client.purchases.confirm.post.mutationOptions(),
            onSuccess: () => {
                void queryClient.invalidateQueries({ queryKey: ["punch", "dashboard"] });
                void queryClient.invalidateQueries({ queryKey: ["consumption", "history"] });
            },
        }),
    );
};

export const useTransactionStatus = (transactionId: string | undefined) => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client.transactions({
            transactionId: transactionId ?? "",
        }).get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["consumption", "transactions", transactionId],
        select: unwrapResponse,
        enabled: !!transactionId,
        refetchInterval: (query) =>
            query.state.data && (query.state.data as { status: string }).status === "pending"
                ? 2000
                : false,
    });
};

export const useRequestPunchRedemption = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client({ cafeId })["punch-redemptions"].post.mutationOptions(),
            onSuccess: () =>
                queryClient.invalidateQueries({ queryKey: ["punch", "dashboard"] }),
        }),
    );
};

export const useDecidePunchRedemption = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            mutationFn: async (variables: { requestId: string; [key: string]: unknown }) => {
                const { requestId, ...body } = variables;
                return client({ cafeId })
                    ["punch-redemptions"]({ requestId })
                    .decide.post.mutationOptions()
                    .mutationFn(body as never);
            },
            onSuccess: () =>
                queryClient.invalidateQueries({
                    queryKey: ["consumption", "redemption-inbox", cafeId],
                }),
        }),
    );
};

export const useRequestVoucherRedemption = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client({ cafeId })["voucher-redemptions"].post.mutationOptions(),
            onSuccess: () =>
                queryClient.invalidateQueries({ queryKey: ["punch", "vouchers"] }),
        }),
    );
};

export const useDecideVoucherRedemption = (cafeId: string) => {
    const client = useElysia().consumption;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            mutationFn: async (variables: { requestId: string; [key: string]: unknown }) => {
                const { requestId, ...body } = variables;
                return client({ cafeId })
                    ["voucher-redemptions"]({ requestId })
                    .decide.post.mutationOptions()
                    .mutationFn(body as never);
            },
            onSuccess: () =>
                queryClient.invalidateQueries({
                    queryKey: ["consumption", "redemption-inbox", cafeId],
                }),
        }),
    );
};

export const useCafeRedemptionInbox = (cafeId: string) => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client({ cafeId })["redemption-inbox"].get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["consumption", "redemption-inbox", cafeId],
        select: unwrapResponse,
        refetchInterval: 5000,
    });
};
```

```typescript
// src/core/punch/client/hooks.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { useElysia } from "@/frontend/lib/eden";

const unwrapResponse = (result: unknown) => (result as { response: unknown }).response;

export const useDashboard = () => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.dashboard.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["punch", "dashboard"],
        select: unwrapResponse,
    });
};

export const useCampaigns = () => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.campaigns.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["punch", "campaigns"],
        select: unwrapResponse,
    });
};

export const useCampaign = (id: string) => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.campaigns({ id }).get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["punch", "campaigns", id],
        select: unwrapResponse,
    });
};

export const useCrawls = () => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.crawls.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["punch", "crawls"],
        select: unwrapResponse,
    });
};

export const useCrawl = (id: string) => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.crawls({ id }).get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["punch", "crawls", id],
        select: unwrapResponse,
    });
};

export const useVouchers = () => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.vouchers.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["punch", "vouchers"],
        select: unwrapResponse,
    });
};
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no errors — this is what confirms every Eden route path (`.consumption`, `.punch`, nested params) matches the routers registered in Step 5, since `useElysia()` is typed off `AppRouter`.

- [ ] **Step 8: Commit**

```bash
git add src/core/punch/server src/core/consumption/client src/core/punch/client src/server/router.ts
git commit -m "feat(punch): register punch router, dashboard aggregate, and Eden client hooks"
```

---

### Task 11: Shared transaction-status component, bottom nav shell, `/home`

**Files:**
- Create: `src/core/consumption/client/ui/transaction-status.tsx`
- Test: `src/core/consumption/client/ui/__tests__/transaction-status.test.ts`
- Create: `src/core/punch/client/ui/punch-meter.tsx`
- Test: `src/core/punch/client/ui/__tests__/punch-meter.test.ts`
- Create: `src/frontend/components/nav/bottom-nav.tsx`
- Create: `src/frontend/components/consumer/consumer-shell.css`
- Create: `src/app/(app)/home/page.tsx`
- Create: `src/app/(app)/more/page.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/frontend/providers/providers.tsx` (`redirectTo="/home"`)

**Interfaces:**
- Consumes: `useDashboard` (Task 10), `progressFraction` return shape `{ numerator, denominator }` (Task 2), `ChainTransactionStatus` (`{ transactionId, status, rejectionReason? }`, Task 4).
- Produces: `UiTransactionState = "loading" | "awaiting_signature" | ConsumerTransactionStatus`, `transactionStatusCopy(status: UiTransactionState): { label: string; hint: string }` covering all six mandated labels, `<TransactionStatus status rejectionReason />`, `<PunchMeter balance />`, `<BottomNav />`, and `/more` links to campaigns, crawls, profile/sign-out, and install help.

- [ ] **Step 1: Write the failing copy-mapping test**

```typescript
// src/core/consumption/client/ui/__tests__/transaction-status.test.ts
import { describe, expect, it } from "vitest";
import { transactionStatusCopy } from "../transaction-status";

describe("transactionStatusCopy", () => {
    it("maps pre-submit states to mandated Spanish labels", () => {
        expect(transactionStatusCopy("loading").label).toBe("Cargando");
        expect(transactionStatusCopy("awaiting_signature")).toEqual({
            label: "Esperando firma",
            hint: "Confirma para autorizar.",
        });
    });
    it("maps pending to the on-chain waiting copy", () => {
        expect(transactionStatusCopy("pending")).toEqual({
            label: "Pendiente on-chain",
            hint: "Esto puede tardar unos segundos.",
        });
    });
    it("maps confirmed to a success copy", () => {
        expect(transactionStatusCopy("confirmed")).toEqual({
            label: "Confirmado",
            hint: "Tu PUNCH se actualizó.",
        });
    });
    it("maps failed to a retry copy", () => {
        expect(transactionStatusCopy("failed")).toEqual({
            label: "Reintento disponible",
            hint: "Intenta de nuevo.",
        });
    });
    it("maps rejected to an actionable copy", () => {
        expect(transactionStatusCopy("rejected")).toEqual({
            label: "Rechazado",
            hint: "Revisa el motivo indicado por el café.",
        });
    });
});
```

- [ ] **Step 2: Run and confirm failure, then implement**

Run: `pnpm vitest run src/core/consumption/client/ui/__tests__/transaction-status.test.ts` → FAIL

```typescript
// src/core/consumption/client/ui/transaction-status.tsx
import type { ConsumerTransactionStatus } from "@/core/consumption/domain/transitions";

export type UiTransactionState =
    | "loading"
    | "awaiting_signature"
    | ConsumerTransactionStatus;

export function transactionStatusCopy(
    status: UiTransactionState,
): { label: string; hint: string } {
    switch (status) {
        case "loading":
            return { label: "Cargando", hint: "Estamos preparando la operación." };
        case "awaiting_signature":
            return { label: "Esperando firma", hint: "Confirma para autorizar." };
        case "pending":
            return { label: "Pendiente on-chain", hint: "Esto puede tardar unos segundos." };
        case "confirmed":
            return { label: "Confirmado", hint: "Tu PUNCH se actualizó." };
        case "failed":
            return { label: "Reintento disponible", hint: "Intenta de nuevo." };
        case "rejected":
            return { label: "Rechazado", hint: "Revisa el motivo indicado por el café." };
    }
}

export function TransactionStatus({
    status,
    rejectionReason,
    onRetry,
}: {
    status: UiTransactionState;
    rejectionReason?: string;
    onRetry?: () => void;
}) {
    const copy = transactionStatusCopy(status);
    return (
        <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-1 rounded-md border p-4"
        >
            <span className="font-medium">{copy.label}</span>
            <span className="text-muted-foreground text-sm">
                {status === "rejected" && rejectionReason ? rejectionReason : copy.hint}
            </span>
            {status === "failed" && onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-2 self-start text-primary text-sm underline"
                >
                    Reintentar
                </button>
            )}
        </div>
    );
}
```

Run: `pnpm vitest run src/core/consumption/client/ui/__tests__/transaction-status.test.ts` → PASS (5 tests)

- [ ] **Step 3: Write the failing punch-meter test, then implement**

```typescript
// src/core/punch/client/ui/__tests__/punch-meter.test.ts
import { describe, expect, it } from "vitest";
import { punchMeterLabel } from "../punch-meter";

describe("punchMeterLabel", () => {
    it("shows the raw fraction below the cap", () => {
        expect(punchMeterLabel(5)).toBe("5 / 12");
    });
    it("shows the eligible message at or above the cap", () => {
        expect(punchMeterLabel(12)).toBe("12 / 12 — Recompensa disponible");
        expect(punchMeterLabel(15)).toBe("12 / 12 — Recompensa disponible");
    });
});
```

```typescript
// src/core/punch/client/ui/punch-meter.tsx
import { progressFraction } from "@/core/punch/domain/progress";

export function punchMeterLabel(balance: number): string {
    const { numerator, denominator } = progressFraction(balance);
    return numerator >= denominator
        ? `${numerator} / ${denominator} — Recompensa disponible`
        : `${numerator} / ${denominator}`;
}

export function PunchMeter({ balance }: { balance: number }) {
    const { numerator, denominator } = progressFraction(balance);
    return (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-6">
            <div
                role="meter"
                aria-valuenow={numerator}
                aria-valuemin={0}
                aria-valuemax={denominator}
                className="relative h-32 w-32 rounded-full border-8 border-muted"
                style={{
                    borderTopColor: "var(--primary)",
                    transform: `rotate(${(numerator / denominator) * 360}deg)`,
                }}
            >
                <span className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 font-semibold text-2xl">
                    {numerator}/{denominator}
                </span>
            </div>
            <p className="text-center text-muted-foreground text-sm">
                {punchMeterLabel(balance)}
            </p>
        </div>
    );
}
```

Run: `pnpm vitest run src/core/punch/client/ui/__tests__/punch-meter.test.ts` → PASS (2 tests)

- [ ] **Step 4: Build the bottom nav shell**

```typescript
// src/frontend/components/nav/bottom-nav.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
    { href: "/home", label: "Inicio" },
    { href: "/discover", label: "Descubre" },
    { href: "/scan", label: "Escanear" },
    { href: "/history", label: "Historial" },
    { href: "/more", label: "Más" },
] as const;

export function BottomNav() {
    const pathname = usePathname();
    return (
        <nav
            aria-label="Navegación principal"
            className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background md:static md:border-t-0"
        >
            {TABS.map((tab) => {
                const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-11 flex-1 flex-col items-center justify-center py-2 text-xs ${
                            active ? "font-semibold text-primary" : "text-muted-foreground"
                        }`}
                    >
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}
```

- [ ] **Step 5: Add landing-aligned product styles and `/more` hub**

```css
/* src/frontend/components/consumer/consumer-shell.css */
.consumer-shell {
    min-height: 100svh;
    color: var(--color-ink);
    background: var(--color-paper);
    font-family: var(--font-body);
}
.consumer-eyebrow {
    font-family: var(--font-outlier);
    letter-spacing: 0.1em;
    text-transform: uppercase;
}
.consumer-title {
    font-family: var(--font-display);
    text-wrap: balance;
}
.consumer-panel {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-paper) 92%, white);
    box-shadow: var(--shadow-print-sm);
}
.consumer-voucher {
    border: 1px dashed var(--color-cafe-blue);
    background: color-mix(in srgb, var(--color-cafe-blue) 10%, var(--color-paper));
}
```

`src/app/(app)/more/page.tsx` renders four 44px-minimum links: `/campaigns` (“Campañas”), `/crawls` (“Rutas de café”), profile/sign-out, and install help. Import `consumer-shell.css` once from `src/app/(app)/layout.tsx`; do not copy landing tokens into this file.

- [ ] **Step 6: Wire the nav into the app layout and change the redirect target**

```typescript
// src/app/(app)/layout.tsx (replace)
import type { PropsWithChildren } from "react";
import { requireAuth } from "@/server/auth/require-auth";
import { BottomNav } from "@/frontend/components/nav/bottom-nav";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: PropsWithChildren) {
    const { user } = await requireAuth();
    return (
        <div className="min-h-svh pb-16 md:pb-0">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
                <span className="font-semibold">PUNCH</span>
                <div className="flex items-center gap-3 text-muted-foreground text-sm">
                    <span>{user.email}</span>
                    {user.isOps && <a href="/ops">Ops</a>}
                    <SignOutButton />
                </div>
            </header>
            <main>{children}</main>
            <BottomNav />
        </div>
    );
}
```

```typescript
// src/frontend/providers/providers.tsx — change one line
redirectTo="/home"
```

- [ ] **Step 7: Build `/home` with all required states**

```typescript
// src/app/(app)/home/page.tsx
"use client";
import Link from "next/link";
import { useDashboard } from "@/core/punch/client/hooks";
import { PunchMeter } from "@/core/punch/client/ui/punch-meter";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function HomePage() {
    const dashboardQuery = useDashboard();

    if (dashboardQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    if (dashboardQuery.isError) {
        return (
            <div className="space-y-3 p-6 text-center">
                <p className="text-destructive">No se pudo cargar tu progreso.</p>
                <Button onClick={() => dashboardQuery.refetch()}>Reintentar</Button>
            </div>
        );
    }

    const dashboard = dashboardQuery.data as {
        balance: number;
        activeCampaign: { id: string; name: string } | null;
        activeCrawl: { id: string; name: string; completedSteps: number; totalSteps: number } | null;
    };

    return (
        <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
            <h1 className="font-semibold text-2xl">Hola de nuevo</h1>
            <PunchMeter balance={dashboard.balance} />
            <Button asChild size="lg" className="w-full">
                <Link href="/scan">Escanear compra</Link>
            </Button>
            {dashboard.activeCampaign && (
                <Card>
                    <CardHeader>
                        <CardTitle>Campaña activa</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Link href={`/campaigns/${dashboard.activeCampaign.id}`}>
                            {dashboard.activeCampaign.name}
                        </Link>
                    </CardContent>
                </Card>
            )}
            {dashboard.activeCrawl && (
                <Card>
                    <CardHeader>
                        <CardTitle>Ruta de café</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Link href={`/crawls/${dashboard.activeCrawl.id}`}>
                            {dashboard.activeCrawl.completedSteps} /{" "}
                            {dashboard.activeCrawl.totalSteps} cafés visitados
                        </Link>
                    </CardContent>
                </Card>
            )}
            <Card>
                <CardHeader>
                    <CardTitle>Cafés cerca de ti</CardTitle>
                </CardHeader>
                <CardContent>
                    <Button asChild variant="outline">
                        <Link href="/discover">Ver descubrimiento</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
```

- [ ] **Step 8: Typecheck and build**

Run: `pnpm typecheck && pnpm build`

- [ ] **Step 9: Commit**

```bash
git add src/core/consumption/client/ui src/core/punch/client/ui \
        src/frontend/components/nav src/frontend/components/consumer/consumer-shell.css \
        src/app/\(app\)/home src/app/\(app\)/more src/app/\(app\)/layout.tsx \
        src/frontend/providers/providers.tsx
git commit -m "feat(home): add bottom nav, PUNCH meter, and consumer dashboard"
```

---

### Task 12: Scan, purchase confirmation, history, redeem, campaigns, crawls pages

**Files:**
- Create: `src/app/(app)/scan/page.tsx`
- Create: `src/app/(app)/purchase/[proofId]/page.tsx`
- Create: `src/app/(app)/history/page.tsx`
- Create: `src/app/(app)/redeem/[productId]/page.tsx`
- Create: `src/app/(app)/campaigns/page.tsx`
- Create: `src/app/(app)/campaigns/[campaignId]/page.tsx`
- Create: `src/app/(app)/crawls/page.tsx`
- Create: `src/app/(app)/crawls/[crawlId]/page.tsx`
- Create: `src/core/consumption/server/services/list-history-service.ts`
- Test: `src/core/consumption/server/services/__tests__/list-history-service.test.ts`
- Create: `src/core/consumption/server/api/routes/list-history.route.ts`
- Modify: `src/core/consumption/server/api/router.ts`
- Modify: `src/core/consumption/client/hooks.ts` (add `useHistory`)

**Interfaces:**
- Consumes: `useTransactionStatus`, `useConfirmPurchase`, `usePurchaseProof` (Task 10/11), `useCampaigns`, `useCampaign`, `useCrawls`, `useCrawl`, `useVouchers` (Task 10), `useRequestPunchRedemption`, `useRequestVoucherRedemption` (Task 10), `TransactionStatus` (Task 11).
- Produces: `useHistory()` hook backed by `GET /api/v1/consumption/history`; page components with no further downstream consumers.

- [ ] **Step 1: Write failing history isolation test**

```typescript
// src/core/consumption/server/services/__tests__/list-history-service.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/drizzle/db", () => ({
    db: {
        select: vi.fn(() => ({
            from: () => ({
                where: () => ({
                    orderBy: async () => [
                        {
                            id: "tx-2",
                            operation: "punch_redemption",
                            cafeId: "cafe-1",
                            status: "confirmed",
                            rejectionReason: null,
                            createdAt: new Date("2026-08-08T12:00:00Z"),
                        },
                    ],
                }),
            }),
        })),
    },
}));

import { listHistoryService } from "../list-history-service";

describe("listHistoryService", () => {
    it("returns consumer-safe entries newest first", async () => {
        const result = await listHistoryService("consumer-a");
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual([
                expect.objectContaining({
                    id: "tx-2",
                    operation: "punch_redemption",
                    createdAt: "2026-08-08T12:00:00.000Z",
                }),
            ]);
            expect(result.data[0]).not.toHaveProperty("consumerUserId");
        }
    });
});
```

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/list-history-service.test.ts`

Expected: FAIL — service module does not exist.

- [ ] **Step 2: Implement `list-history-service.ts` and route**

```typescript
// src/core/consumption/server/services/list-history-service.ts
import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { consumerTransaction } from "@/server/drizzle/schemas/consumption-schema";
import { AsyncAppResult, ok } from "@/server/common/responses";

export type HistoryEntry = {
    id: string;
    operation: "emission" | "punch_redemption" | "voucher_redemption";
    cafeId: string;
    status: "pending" | "confirmed" | "rejected" | "failed";
    rejectionReason: string | null;
    createdAt: string;
};

export async function listHistoryService(
    consumerUserId: string,
): AsyncAppResult<HistoryEntry[]> {
    const rows = await db
        .select()
        .from(consumerTransaction)
        .where(eq(consumerTransaction.consumerUserId, consumerUserId))
        .orderBy(desc(consumerTransaction.createdAt));
    return ok(
        rows.map((row) => ({
            id: row.id,
            operation: row.operation,
            cafeId: row.cafeId,
            status: row.status,
            rejectionReason: row.rejectionReason,
            createdAt: row.createdAt.toISOString(),
        })),
    );
}
```

```typescript
// src/core/consumption/server/api/routes/list-history.route.ts
import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse } from "@/server/common/responses";
import { listHistoryService } from "../../services/list-history-service";

export const listHistoryRoute = new Elysia().use(authed).get(
    "/history",
    async ({ user, status }) => {
        const result = await listHistoryService(user.id);
        if (!result.ok) return status(result.error.status as 500, errorToResponse(result.error));
        return status(200, CommonResponse.successful({ response: result.data }));
    },
    {
        authed: true,
        response: {
            200: t.Object({ status: t.Literal(200), response: t.Array(t.Any()) }),
            401: errorResponseSchema(401),
        },
        detail: { tags: ["Consumption"], summary: "List the consumer's history" },
    },
);
```

Register `listHistoryRoute` on `consumptionRouter` in `src/core/consumption/server/api/router.ts` (add `.use(listHistoryRoute)`).

Add to `src/core/consumption/client/hooks.ts`:

```typescript
export const useHistory = () => {
    const client = useElysia().consumption;
    return useQuery({
        ...(client.history.get.queryOptions() as unknown as Record<string, unknown>),
        queryKey: ["consumption", "history"],
        select: unwrapResponse,
    });
};
```

- [ ] **Step 2: Typecheck the router change**

Run: `pnpm typecheck`

- [ ] **Step 3: Build `/scan`**

```typescript
// src/app/(app)/scan/page.tsx
"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent } from "@/frontend/components/ui/card";
import { Input } from "@/frontend/components/ui/input";

export default function ScanPage() {
    const router = useRouter();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [pastedCode, setPastedCode] = useState("");
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [supportsCamera] = useState(
        () => typeof window !== "undefined" && "BarcodeDetector" in window,
    );

    useEffect(() => {
        if (!supportsCamera) return;
        let stream: MediaStream | undefined;
        let cancelled = false;
        (async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true });
                if (cancelled) return;
                if (videoRef.current) videoRef.current.srcObject = stream;
                const Detector = (window as unknown as {
                    BarcodeDetector: new (opts: { formats: string[] }) => {
                        detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
                    };
                }).BarcodeDetector;
                const detector = new Detector({ formats: ["qr_code"] });
                const tick = async () => {
                    if (cancelled || !videoRef.current) return;
                    const codes = await detector.detect(videoRef.current);
                    const proofId = codes[0]?.rawValue?.split("/purchase/")[1];
                    if (proofId) {
                        router.push(`/purchase/${proofId}`);
                        return;
                    }
                    requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            } catch {
                setCameraError("No se pudo acceder a la cámara.");
            }
        })();
        return () => {
            cancelled = true;
            stream?.getTracks().forEach((track) => track.stop());
        };
    }, [supportsCamera, router]);

    const openPastedCode = () => {
        const proofId = pastedCode.trim().split("/purchase/").pop();
        if (proofId) router.push(`/purchase/${proofId}`);
    };

    return (
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
            <h1 className="font-semibold text-2xl">Escanear compra</h1>
            {supportsCamera && !cameraError ? (
                <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full rounded-lg border"
                />
            ) : (
                <Card>
                    <CardContent className="p-4 text-muted-foreground text-sm">
                        {cameraError ?? "Tu navegador no soporta escaneo con cámara."} Pega el
                        código o enlace que te dio el barista.
                    </CardContent>
                </Card>
            )}
            <div className="flex gap-2">
                <Input
                    value={pastedCode}
                    onChange={(e) => setPastedCode(e.target.value)}
                    placeholder="Pega el enlace o código"
                    aria-label="Código de compra"
                />
                <Button onClick={openPastedCode}>Abrir</Button>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Build `/purchase/[proofId]`**

```typescript
// src/app/(app)/purchase/[proofId]/page.tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useConfirmPurchase, usePurchaseProof, useTransactionStatus } from "@/core/consumption/client/hooks";
import { TransactionStatus } from "@/core/consumption/client/ui/transaction-status";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function PurchaseConfirmPage() {
    const { proofId } = useParams<{ proofId: string }>();
    const router = useRouter();
    const proofQuery = usePurchaseProof(proofId);
    const confirmPurchase = useConfirmPurchase();
    const [transactionId, setTransactionId] = useState<string | undefined>();
    const statusQuery = useTransactionStatus(transactionId);
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        setIsOnline(navigator.onLine);
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        window.addEventListener("online", goOnline);
        window.addEventListener("offline", goOffline);
        return () => {
            window.removeEventListener("online", goOnline);
            window.removeEventListener("offline", goOffline);
        };
    }, []);

    if (proofQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    if (proofQuery.isError || !proofQuery.data) {
        return <p className="p-6 text-destructive">No se pudo cargar la compra.</p>;
    }

    const proof = proofQuery.data as {
        id: string;
        cafeId: string;
        productId: string;
        amountCentimos: number;
        expiresAt: string;
        status: string;
    };
    const expired = new Date(proof.expiresAt) < new Date();

    const confirm = () => {
        confirmPurchase.mutate(
            { proofId: proof.id },
            { onSuccess: (result) => setTransactionId((result as { transactionId: string }).transactionId) },
        );
    };

    return (
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>Confirma tu compra</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <p>Monto: S/ {(proof.amountCentimos / 100).toFixed(2)}</p>
                    <p className="text-muted-foreground text-sm">
                        Expira: {new Date(proof.expiresAt).toLocaleTimeString("es-PE")}
                    </p>
                </CardContent>
            </Card>
            {expired && !transactionId && (
                <p className="text-destructive text-sm">Pide al barista uno nuevo.</p>
            )}
            {!isOnline && (
                <p className="text-amber-700 text-sm">
                    Sin conexión. Reconéctate para confirmar la compra.
                </p>
            )}
            {transactionId && statusQuery.data ? (
                <TransactionStatus
                    status={(statusQuery.data as { status: never }).status}
                    rejectionReason={(statusQuery.data as { rejectionReason?: string }).rejectionReason}
                    onRetry={confirm}
                />
            ) : (
                <Button
                    size="lg"
                    className="w-full"
                    disabled={expired || !isOnline || confirmPurchase.isPending}
                    onClick={confirm}
                >
                    {confirmPurchase.isPending ? "Confirma para autorizar" : "Confirmar compra"}
                </Button>
            )}
            {(statusQuery.data as { status?: string } | undefined)?.status === "confirmed" && (
                <Button variant="outline" className="w-full" onClick={() => router.push("/home")}>
                    Volver a Inicio
                </Button>
            )}
        </div>
    );
}
```

- [ ] **Step 5: Build `/history`, `/redeem/[productId]`, `/campaigns` + `[campaignId]`, `/crawls` + `[crawlId]`**

```typescript
// src/app/(app)/history/page.tsx
"use client";
import { useHistory } from "@/core/consumption/client/hooks";
import { Card, CardContent } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

const OPERATION_LABEL: Record<string, string> = {
    emission: "PUNCH ganado",
    punch_redemption: "Canje de PUNCH",
    voucher_redemption: "Voucher usado",
};

export default function HistoryPage() {
    const historyQuery = useHistory();
    if (historyQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    const entries = (historyQuery.data ?? []) as Array<{
        id: string;
        operation: string;
        status: string;
        rejectionReason: string | null;
        createdAt: string;
    }>;
    return (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            <h1 className="font-semibold text-2xl">Historial</h1>
            {entries.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-muted-foreground">
                        Todavía no tienes actividad.
                    </CardContent>
                </Card>
            ) : (
                entries.map((entry) => (
                    <Card key={entry.id}>
                        <CardContent className="flex items-center justify-between p-4">
                            <div>
                                <p className="font-medium">{OPERATION_LABEL[entry.operation]}</p>
                                <p className="text-muted-foreground text-sm">
                                    {new Date(entry.createdAt).toLocaleString("es-PE")}
                                </p>
                                {entry.rejectionReason && (
                                    <p className="text-destructive text-sm">{entry.rejectionReason}</p>
                                )}
                            </div>
                            <span className="text-sm">{entry.status}</span>
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );
}
```

```typescript
// src/app/(app)/redeem/[productId]/page.tsx
"use client";
import { useParams, useSearchParams } from "next/navigation";
import { useCafeProducts } from "@/core/cafe/client/hooks";
import { useRequestPunchRedemption } from "@/core/consumption/client/hooks";
import { useDashboard } from "@/core/punch/client/hooks";
import { canRedeem } from "@/core/punch/domain/progress";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function RedeemPage() {
    const { productId } = useParams<{ productId: string }>();
    const cafeId = useSearchParams().get("cafeId") ?? "";
    const dashboardQuery = useDashboard();
    const productsQuery = useCafeProducts(cafeId);
    const requestRedemption = useRequestPunchRedemption(cafeId);

    if (dashboardQuery.isPending || productsQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }

    const balance = (dashboardQuery.data as { balance: number }).balance;
    const product = ((productsQuery.data ?? []) as Array<{ id: string; name: string }>).find(
        (p) => p.id === productId,
    );
    const eligible = canRedeem(balance);

    return (
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{product?.name ?? "Recompensa"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <p>Costo fijo: 12 PUNCH</p>
                    <p className="text-muted-foreground text-sm">Tu progreso: {balance} / 12</p>
                    {!eligible && (
                        <p className="text-amber-700 text-sm">
                            Necesitas 12 PUNCH para canjear.
                        </p>
                    )}
                </CardContent>
            </Card>
            <Button
                size="lg"
                className="w-full"
                disabled={!eligible || requestRedemption.isPending}
                onClick={() => requestRedemption.mutate({ productId })}
            >
                {requestRedemption.isPending ? "Enviando…" : "Canjear 12 PUNCH"}
            </Button>
        </div>
    );
}
```

```typescript
// src/app/(app)/campaigns/page.tsx
"use client";
import Link from "next/link";
import { useCampaigns } from "@/core/punch/client/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function CampaignsPage() {
    const campaignsQuery = useCampaigns();
    if (campaignsQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    const campaigns = (campaignsQuery.data ?? []) as Array<{ id: string; name: string }>;
    return (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            <h1 className="font-semibold text-2xl">Campañas</h1>
            {campaigns.map((c) => (
                <Link key={c.id} href={`/campaigns/${c.id}`}>
                    <Card>
                        <CardHeader>
                            <CardTitle>{c.name}</CardTitle>
                        </CardHeader>
                    </Card>
                </Link>
            ))}
        </div>
    );
}
```

```typescript
// src/app/(app)/campaigns/[campaignId]/page.tsx
"use client";
import { useParams } from "next/navigation";
import { useCampaign } from "@/core/punch/client/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function CampaignDetailPage() {
    const { campaignId } = useParams<{ campaignId: string }>();
    const campaignQuery = useCampaign(campaignId);
    if (campaignQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    if (campaignQuery.isError || !campaignQuery.data) {
        return <p className="p-6 text-destructive">No se pudo cargar la campaña.</p>;
    }
    const campaign = campaignQuery.data as { name: string; windowEnd: string };
    return (
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{campaign.name}</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground text-sm">
                        Vence: {new Date(campaign.windowEnd).toLocaleDateString("es-PE")}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
```

```typescript
// src/app/(app)/crawls/page.tsx
"use client";
import Link from "next/link";
import { useCrawls } from "@/core/punch/client/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function CrawlsPage() {
    const crawlsQuery = useCrawls();
    if (crawlsQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    const crawls = (crawlsQuery.data ?? []) as Array<{ id: string; name: string }>;
    return (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            <h1 className="font-semibold text-2xl">Rutas de café</h1>
            {crawls.map((c) => (
                <Link key={c.id} href={`/crawls/${c.id}`}>
                    <Card>
                        <CardHeader>
                            <CardTitle>{c.name}</CardTitle>
                        </CardHeader>
                    </Card>
                </Link>
            ))}
        </div>
    );
}
```

```typescript
// src/app/(app)/crawls/[crawlId]/page.tsx
"use client";
import { useParams } from "next/navigation";
import { useCrawl } from "@/core/punch/client/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function CrawlDetailPage() {
    const { crawlId } = useParams<{ crawlId: string }>();
    const crawlQuery = useCrawl(crawlId);
    if (crawlQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    if (crawlQuery.isError || !crawlQuery.data) {
        return <p className="p-6 text-destructive">No se pudo cargar la ruta.</p>;
    }
    const crawl = crawlQuery.data as {
        name: string;
        steps: Array<{ stepIndex: number; cafeId: string }>;
    };
    return (
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{crawl.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {crawl.steps.map((step) => (
                        <p key={step.stepIndex}>
                            Paso {step.stepIndex + 1}: café {step.cafeId}
                        </p>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm typecheck && pnpm build`

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/scan src/app/\(app\)/purchase src/app/\(app\)/history \
        src/app/\(app\)/redeem src/app/\(app\)/campaigns src/app/\(app\)/crawls \
        src/core/consumption/server/services/list-history-service.ts \
        src/core/consumption/server/api src/core/consumption/client/hooks.ts
git commit -m "feat(consumer): scan, purchase confirmation, history, redeem, campaign, and crawl pages"
```

---

### Task 13: Café terminal, redemption inbox, discovery updates

**Files:**
- Create: `src/app/(app)/cafe/[cafeId]/terminal/page.tsx`
- Create: `src/app/(app)/cafe/[cafeId]/redemptions/page.tsx`
- Modify: `src/app/(app)/discover/page.tsx` (district grouping + "Cerca de mí")
- Modify: `src/app/(app)/discover/[cafeId]/page.tsx` (separate emission/reward/voucher sections)
- Modify: `src/app/(app)/cafe/[cafeId]/page.tsx` (add links to `/terminal` and `/redemptions`)
- Create: `src/frontend/components/consumer/discovery-distance.ts`
- Test: `src/frontend/components/consumer/__tests__/discovery-distance.test.ts`

Before page work, test `distanceKm` with identical coordinates (`0`), known Lima coordinates within tolerance, and `sortCafesByDistance` behavior placing cafés without coordinates after located cafés. Implement both pure helpers in `discovery-distance.ts`; `discover/page.tsx` imports them instead of defining distance math inline.

**Interfaces:**
- Consumes: `useCreatePurchaseProof`, `usePurchaseProof`, `useCafeRedemptionInbox`, `useDecidePunchRedemption`, `useDecideVoucherRedemption` (Task 10), `useCafeProducts` (existing `src/core/cafe/client/hooks.ts`), `qrcode` npm package for client-side QR rendering.

- [ ] **Step 1: Add the `qrcode` dependency**

Run: `pnpm add qrcode && pnpm add -D @types/qrcode`

- [ ] **Step 2: Build the café terminal page**

```typescript
// src/app/(app)/cafe/[cafeId]/terminal/page.tsx
"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useCafeProducts } from "@/core/cafe/client/hooks";
import { useCreatePurchaseProof } from "@/core/consumption/client/hooks";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/frontend/components/ui/select";

export default function CafeTerminalPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const productsQuery = useCafeProducts(cafeId);
    const createProof = useCreatePurchaseProof(cafeId);
    const [productId, setProductId] = useState("");
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const emissionProducts = ((productsQuery.data ?? []) as Array<{
        id: string;
        name: string;
        type: string;
        approvalStatus: string;
        active: boolean;
    }>).filter((p) => p.type === "emission" && p.approvalStatus === "approved" && p.active);

    useEffect(() => {
        if (createProof.data && canvasRef.current) {
            const deepLink = `${window.location.origin}${(createProof.data as { deepLink: string }).deepLink}`;
            QRCode.toCanvas(canvasRef.current, deepLink);
        }
    }, [createProof.data]);

    const generate = () => {
        if (!productId) return;
        const receiptHash = `0x${crypto.getRandomValues(new Uint8Array(32))
            .reduce((acc, b) => acc + b.toString(16).padStart(2, "0"), "")}`;
        createProof.mutate({ productId, receiptHash });
    };

    return (
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>Generar compra</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Select value={productId} onValueChange={setProductId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Elige un producto de emisión" />
                        </SelectTrigger>
                        <SelectContent>
                            {emissionProducts.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        className="w-full"
                        disabled={!productId || createProof.isPending}
                        onClick={generate}
                    >
                        {createProof.isPending ? "Generando…" : "Generar QR"}
                    </Button>
                </CardContent>
            </Card>
            {createProof.data && (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 p-4">
                        <canvas ref={canvasRef} />
                        <p className="break-all text-muted-foreground text-xs">
                            {window.location.origin}
                            {(createProof.data as { deepLink: string }).deepLink}
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
```

- [ ] **Step 3: Build the café redemption inbox page**

```typescript
// src/app/(app)/cafe/[cafeId]/redemptions/page.tsx
"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
    useCafeRedemptionInbox,
    useDecidePunchRedemption,
    useDecideVoucherRedemption,
} from "@/core/consumption/client/hooks";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent } from "@/frontend/components/ui/card";
import { Input } from "@/frontend/components/ui/input";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function CafeRedemptionsPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const inboxQuery = useCafeRedemptionInbox(cafeId);
    const decidePunch = useDecidePunchRedemption(cafeId);
    const decideVoucher = useDecideVoucherRedemption(cafeId);
    const [reasons, setReasons] = useState<Record<string, string>>({});

    if (inboxQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }

    const requests = (inboxQuery.data ?? []) as Array<{
        id: string;
        kind: "punch_reward" | "voucher";
        status: string;
    }>;

    const decide = (
        request: { id: string; kind: "punch_reward" | "voucher" },
        decision: "approved" | "rejected",
    ) => {
        const mutation = request.kind === "punch_reward" ? decidePunch : decideVoucher;
        mutation.mutate({
            requestId: request.id,
            decision,
            rejectionReason: decision === "rejected" ? reasons[request.id] : undefined,
        });
    };

    return (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            <h1 className="font-semibold text-2xl">Bandeja de canjes</h1>
            {requests.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-muted-foreground">
                        No hay solicitudes pendientes.
                    </CardContent>
                </Card>
            ) : (
                requests.map((request) => (
                    <Card key={request.id}>
                        <CardContent className="space-y-3 p-4">
                            <p className="font-medium">
                                {request.kind === "punch_reward" ? "Canje de PUNCH" : "Uso de voucher"}
                            </p>
                            <Input
                                placeholder="Motivo si rechazas"
                                value={reasons[request.id] ?? ""}
                                onChange={(e) =>
                                    setReasons((r) => ({ ...r, [request.id]: e.target.value }))
                                }
                            />
                            <div className="flex gap-2">
                                <Button onClick={() => decide(request, "approved")}>Aprobar</Button>
                                <Button
                                    variant="outline"
                                    disabled={!reasons[request.id]}
                                    onClick={() => decide(request, "rejected")}
                                >
                                    Rechazar
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );
}
```

- [ ] **Step 4: Add terminal/redemptions links to the existing café panel**

```typescript
// src/app/(app)/cafe/[cafeId]/page.tsx — add near the StatusBadge header (after the existing header block)
{cafe.onboardingStatus === "approved" && (
    <div className="flex gap-2">
        <Button asChild variant="outline">
            <Link href={`/cafe/${cafeId}/terminal`}>Terminal de compras</Link>
        </Button>
        <Button asChild variant="outline">
            <Link href={`/cafe/${cafeId}/redemptions`}>Bandeja de canjes</Link>
        </Button>
    </div>
)}
```

(`Link` from `next/link` is already imported at the top of this file.)

- [ ] **Step 5: Update discovery for district grouping and progressive geolocation**

```typescript
// src/app/(app)/discover/page.tsx (replace the body, keep imports + loading/error states)
"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useCafes } from "@/core/cafe/client/hooks";
import type { Cafe } from "@/core/cafe/domain/types";
import { sortCafesByDistance } from "@/frontend/components/consumer/discovery-distance";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function DiscoverPage() {
    const cafesQuery = useCafes();
    const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
    const [locationDenied, setLocationDenied] = useState(false);

    const requestLocation = () => {
        if (!("geolocation" in navigator)) {
            setLocationDenied(true);
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => setLocationDenied(true),
        );
    };

    const cafes = (cafesQuery.data ?? []) as Cafe[];
    const sorted = useMemo(
        () => (position ? sortCafesByDistance(cafes, position) : cafes),
        [cafes, position],
    );
    const byDistrict = useMemo(() => {
        const groups = new Map<string, Cafe[]>();
        for (const cafe of sorted) {
            const key = cafe.district ?? "Otros distritos";
            groups.set(key, [...(groups.get(key) ?? []), cafe]);
        }
        return groups;
    }, [sorted]);

    if (cafesQuery.isLoading) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }
    if (cafesQuery.isError) {
        return <p className="p-6 text-destructive">No se pudieron cargar los cafés.</p>;
    }

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="font-semibold text-2xl">Descubre cafés</h1>
                    <p className="text-muted-foreground">
                        Conoce cafés independientes y sus productos de impacto.
                    </p>
                </div>
                {!position && (
                    <Button variant="outline" onClick={requestLocation}>
                        Cerca de mí
                    </Button>
                )}
            </div>
            {locationDenied && (
                <p className="text-muted-foreground text-sm">
                    Puedes seguir explorando por distrito.
                </p>
            )}
            {[...byDistrict.entries()].map(([district, districtCafes]) => (
                <section key={district} className="space-y-3">
                    <h2 className="font-medium text-lg">{district}</h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {districtCafes.map((cafe) => (
                            <Link key={cafe.id} href={`/discover/${cafe.id}`}>
                                <Card className="h-full overflow-hidden transition hover:border-primary">
                                    <CardHeader>
                                        <CardTitle>{cafe.name}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="line-clamp-3 text-sm">
                                            {cafe.description || "Café independiente de la red PUNCH."}
                                        </p>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
```

```typescript
// src/app/(app)/discover/[cafeId]/page.tsx — replace the products section only, keep everything above it
<section className="space-y-4">
    <h2 className="font-semibold text-xl">Productos que dan PUNCH</h2>
    {products.filter((p) => p.type === "emission").length === 0 ? (
        <p className="text-muted-foreground text-sm">Sin productos de emisión por ahora.</p>
    ) : (
        <div className="grid gap-4 sm:grid-cols-2">
            {products
                .filter((p) => p.type === "emission")
                .map((product) => (
                    <Card key={product.id}>
                        <CardHeader>
                            <CardTitle>{product.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="font-medium">S/ {product.priceSoles}</p>
                            <p className="text-muted-foreground text-sm">Emite 1 PUNCH</p>
                        </CardContent>
                    </Card>
                ))}
        </div>
    )}
</section>
<section className="space-y-4">
    <h2 className="font-semibold text-xl">Recompensas (12 PUNCH)</h2>
    <div className="grid gap-4 sm:grid-cols-2">
        {products
            .filter((p) => p.type === "reward")
            .map((product) => (
                <Link key={product.id} href={`/redeem/${product.id}?cafeId=${cafe.id}`}>
                    <Card>
                        <CardHeader>
                            <CardTitle>{product.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground text-sm">Costo fijo: 12 PUNCH</p>
                        </CardContent>
                    </Card>
                </Link>
            ))}
    </div>
</section>
```

- [ ] **Step 6: Typecheck, lint, and build**

Run: `pnpm typecheck && pnpm biome check src && pnpm build`

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/cafe src/app/\(app\)/discover package.json pnpm-lock.yaml
git commit -m "feat(cafe): add QR terminal, redemption inbox, and district-grouped discovery"
```

---

### Task 14: PWA shell, offline reads, deterministic seed, final verification

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`
- Create: `public/icons/punch-192.svg`, `public/icons/punch-512.svg` by copying the approved `src/app/icon.svg` artwork and setting explicit width/height; do not use a photo or temporary asset
- Create: `src/app/pwa-register.tsx`
- Create: `src/app/(app)/offline/page.tsx`
- Create: `src/frontend/components/consumer/offline-snapshot.ts`
- Test: `src/frontend/components/consumer/__tests__/offline-snapshot.test.ts`
- Modify: `src/frontend/components/auth/sign-out.tsx` (clear all PUNCH snapshots before sign-out)
- Modify: `src/app/layout.tsx` (manifest link, landing-aligned theme color, register service worker)
- Modify: `src/app/(app)/home/page.tsx`, `src/app/(app)/history/page.tsx` (user-scoped saved reads + “Datos guardados” label)
- Modify: `scripts/seed.ts` (deterministic demo state per spec §12)

**Interfaces:**
- Consumes: `DEMO_ACCOUNTS`, `SEED_CAFES` (existing `scripts/seed.ts`), `incrementBalance` (Task 4), `createProof`/`bindProofSignatures` are not needed — seed writes `punch_balance_projection`, `consumer_transaction`, `campaign`, `coffee_crawl`, `coffee_crawl_step`, `consumer_crawl_progress` directly via Drizzle inserts.

- [ ] **Step 1: Add the manifest**

```json
// public/manifest.webmanifest
{
    "name": "PUNCH",
    "short_name": "PUNCH",
    "start_url": "/home",
    "display": "standalone",
    "background_color": "#f2ede4",
    "theme_color": "#2b2520",
    "icons": [
        { "src": "/icons/punch-192.svg", "sizes": "192x192", "type": "image/svg+xml", "purpose": "any" },
        { "src": "/icons/punch-512.svg", "sizes": "512x512", "type": "image/svg+xml", "purpose": "any maskable" }
    ]
}
```

- [ ] **Step 2: Add a minimal offline-reads service worker**

```javascript
// public/sw.js
const CACHE_NAME = "punch-shell-v1";
const SHELL_URLS = [
    "/offline",
    "/manifest.webmanifest",
    "/icons/punch-192.svg",
    "/icons/punch-512.svg",
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
    // Never cache authenticated API responses. Dashboard/history use user-scoped
    // local snapshots managed by offline-snapshot.ts.
    if (url.pathname.startsWith("/api/")) return;
    if (event.request.mode === "navigate") {
        event.respondWith(fetch(event.request).catch(() => caches.match("/offline")));
        return;
    }
    event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});
```

- [ ] **Step 3: Test and implement user-scoped saved reads**

```typescript
// src/frontend/components/consumer/__tests__/offline-snapshot.test.ts
import { describe, expect, it } from "vitest";
import {
    clearPunchSnapshots,
    readPunchSnapshot,
    writePunchSnapshot,
} from "../offline-snapshot";

const memoryStorage = () => {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; },
    } as Storage;
};

describe("offline snapshots", () => {
    it("isolates data by user and screen", () => {
        const storage = memoryStorage();
        writePunchSnapshot(storage, "user-a", "dashboard", { balance: 11 });
        expect(readPunchSnapshot(storage, "user-a", "dashboard")).toEqual({ balance: 11 });
        expect(readPunchSnapshot(storage, "user-b", "dashboard")).toBeNull();
    });
    it("clears every PUNCH snapshot on logout", () => {
        const storage = memoryStorage();
        writePunchSnapshot(storage, "user-a", "dashboard", { balance: 11 });
        storage.setItem("unrelated", "keep");
        clearPunchSnapshots(storage);
        expect(storage.getItem("unrelated")).toBe("keep");
        expect(readPunchSnapshot(storage, "user-a", "dashboard")).toBeNull();
    });
});
```

```typescript
// src/frontend/components/consumer/offline-snapshot.ts
const PREFIX = "punch:snapshot:";
const keyFor = (userId: string, screen: string) => `${PREFIX}${userId}:${screen}`;

export function writePunchSnapshot(
    storage: Storage,
    userId: string,
    screen: string,
    value: unknown,
): void {
    storage.setItem(keyFor(userId, screen), JSON.stringify(value));
}
export function readPunchSnapshot<T>(
    storage: Storage,
    userId: string,
    screen: string,
): T | null {
    const raw = storage.getItem(keyFor(userId, screen));
    return raw ? (JSON.parse(raw) as T) : null;
}
export function clearPunchSnapshots(storage: Storage): void {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => key?.startsWith(PREFIX) === true);
    for (const key of keys) storage.removeItem(key);
}
```

Run: `pnpm vitest run src/frontend/components/consumer/__tests__/offline-snapshot.test.ts` → PASS (2 tests).

Use `authClient.useSession().data.user.id` as `userId` in home/history. On successful online reads, write snapshot. If query fails while `navigator.onLine === false`, read snapshot and render it with visible “Datos guardados” label. In `src/frontend/components/auth/sign-out.tsx`, call `clearPunchSnapshots(localStorage)` before existing `authClient.signOut`.

- [ ] **Step 4: Register the service worker and link the manifest**

```typescript
// src/app/pwa-register.tsx
"use client";
import { useEffect } from "react";

export function PwaRegister() {
    useEffect(() => {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js").catch(() => {
                // Non-fatal: the app still works without offline caching.
            });
        }
    }, []);
    return null;
}
```

```typescript
// src/app/layout.tsx — merge into existing typed exports
export const metadata: Metadata = {
    title: "PUNCH — una red de cafeterías independientes",
    description:
        "PUNCH conecta cafeterías independientes para compartir demanda, atraer visitas y generar retornos medibles sin perder su identidad.",
    manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: "#2b2520",
};

// Render inside <body>, before <Providers>:
<PwaRegister />
```

Import `PwaRegister` from `./pwa-register`; retain existing `Metadata` and `Viewport` type imports.

- [ ] **Step 5: Extend the seed script for the canonical demo state**

```typescript
// scripts/seed.ts — add after the existing SEED_CAFES loop and before the wallet-verification block
import {
    consumptionProof,
    consumerTransaction,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";
import {
    campaign,
    coffeeCrawl,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerVoucher,
    punchBalanceProjection,
} from "@/server/drizzle/schemas/punch-schema";

async function seedDemoState() {
    const [consumer] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, "demo-consumer@punch.pe"));
    if (!consumer) throw new Error("seedDemoState: demo consumer not found");

    const [targetCafe] = await db
        .select({ id: cafe.id })
        .from(cafe)
        .where(eq(cafe.slug, "esquina-sur"));
    const [crawlCafeA] = await db.select({ id: cafe.id }).from(cafe).where(eq(cafe.slug, "brujula-cafe"));
    const [crawlCafeB] = await db.select({ id: cafe.id }).from(cafe).where(eq(cafe.slug, "patio-9"));
    if (!targetCafe || !crawlCafeA || !crawlCafeB) {
        throw new Error("seedDemoState: required cafés not found");
    }

    await db
        .insert(punchBalanceProjection)
        .values({ userId: consumer.id, balance: 11 })
        .onConflictDoUpdate({
            target: punchBalanceProjection.userId,
            set: { balance: 11 },
        });

    const [existingCampaign] = await db
        .select({ id: campaign.id })
        .from(campaign)
        .where(eq(campaign.cafeId, targetCafe.id));
    if (!existingCampaign) {
        await db.insert(campaign).values({
            kind: "verified_acquisition",
            cafeId: targetCafe.id,
            name: "Bienvenida a Esquina Sur",
            windowStart: new Date(Date.now() - 7 * 86_400_000),
            windowEnd: new Date(Date.now() + 30 * 86_400_000),
        });
    }

    const [existingCrawl] = await db
        .select({ id: coffeeCrawl.id })
        .from(coffeeCrawl)
        .where(eq(coffeeCrawl.name, "Ruta Miraflores–Barranco–Surquillo"));
    let crawlId = existingCrawl?.id;
    if (!crawlId) {
        const [inserted] = await db
            .insert(coffeeCrawl)
            .values({
                name: "Ruta Miraflores–Barranco–Surquillo",
                expiresAt: new Date(Date.now() + 60 * 86_400_000),
            })
            .returning({ id: coffeeCrawl.id });
        if (!inserted) throw new Error("seedDemoState: could not insert crawl");
        crawlId = inserted.id;
        await db.insert(coffeeCrawlStep).values([
            { crawlId, stepIndex: 0, cafeId: crawlCafeA.id },
            { crawlId, stepIndex: 1, cafeId: crawlCafeB.id },
            { crawlId, stepIndex: 2, cafeId: targetCafe.id },
        ]);
    }

    await db
        .insert(consumerCrawlProgress)
        .values({
            crawlId,
            consumerUserId: consumer.id,
            completedCafeIds: [crawlCafeA.id, crawlCafeB.id],
            status: "in_progress",
        })
        .onConflictDoUpdate({
            target: [consumerCrawlProgress.crawlId, consumerCrawlProgress.consumerUserId],
            set: {
                completedCafeIds: [crawlCafeA.id, crawlCafeB.id],
                status: "in_progress",
            },
        });

    // Canonical reset order respects foreign keys and removes every prior demo
    // fulfillment/proof/voucher before rebuilding 11/12 + crawl 2/3.
    await db.delete(consumerTransaction).where(eq(consumerTransaction.consumerUserId, consumer.id));
    await db.delete(redemptionRequest).where(eq(redemptionRequest.consumerUserId, consumer.id));
    await db.delete(consumerVoucher).where(eq(consumerVoucher.consumerUserId, consumer.id));
    await db.delete(consumptionProof).where(eq(consumptionProof.consumerUserId, consumer.id));

    console.log("+ seeded deterministic demo state (11/12 PUNCH, crawl 2/3, campaign ready)");
}
```

Call `await seedDemoState();` inside `main()` right before the wallet-verification block, but only when `NEXT_PUBLIC_DEMO_MODE` is true:

```typescript
// scripts/seed.ts — inside main(), before the final wallet-verification loop
if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    await seedDemoState();
}
```

- [ ] **Step 6: Run the seed against a real database and verify**

Run: `pnpm db:migrate && NEXT_PUBLIC_DEMO_MODE=true pnpm db:seed`
Expected: `+ seeded deterministic demo state (11/12 PUNCH, crawl 2/3, campaign ready)` printed, followed by `Seed OK — all users have wallets.`

- [ ] **Step 7: Run full verification suite**

Run: `pnpm test`
Expected: all suites pass, including every test added in Tasks 1–13.

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm biome check src`
Expected: no errors.

Run: `pnpm build`
Expected: production build succeeds, including `/home`, `/scan`, `/purchase/[proofId]`, `/history`, `/redeem/[productId]`, `/campaigns`, `/campaigns/[campaignId]`, `/crawls`, `/crawls/[crawlId]`, `/cafe/[cafeId]/terminal`, `/cafe/[cafeId]/redemptions`.

- [ ] **Step 8: Manual two-role acceptance journey (spec §13)**

Run `pnpm dev`, then walk through: sign in as `esquinasur@punch.pe` → `/cafe/{esquinaSurId}/terminal` → generate a QR for the emission product → sign in as `demo-consumer@punch.pe` → `/scan` → paste the deep link → `/purchase/{proofId}` → "Confirmar compra" → observe `Pendiente on-chain` → `Confirmado` and `/home` progress moving from `11 / 12` to `12 / 12` → confirm the campaign voucher and crawl completion appear under `/campaigns` and `/crawls` distinct from the PUNCH meter → request the reward product from `/discover/{esquinaSurId}` → sign back in as the barista → `/cafe/{esquinaSurId}/redemptions` → approve → confirm the consumer's balance drops by exactly 12 and history shows both entries → use a voucher via its café's redemption flow and confirm PUNCH is unchanged → restart `pnpm dev` and confirm `/home` still shows the post-demo balance → toggle browser offline mode and confirm `/home` still renders the last cached read with mutations disabled.

Expected: every step matches spec §13 exactly; note and fix any mismatch before considering the plan complete.

- [ ] **Step 9: Commit**

```bash
git add public scripts/seed.ts src/app/layout.tsx src/app/pwa-register.tsx \
        src/app/\(app\)/offline src/app/\(app\)/home src/app/\(app\)/history \
        src/frontend/components/consumer/offline-snapshot.ts \
        src/frontend/components/consumer/__tests__/offline-snapshot.test.ts \
        src/frontend/components/auth/sign-out.tsx
git commit -m "feat(pwa): add manifest, offline shell, and deterministic demo seed"
```

---

## Self-Review Notes

- **Spec coverage:** §2–3 (progress/redemption rules) → Task 2; §4 IA/routes → Tasks 11–13; §5.2–5.6 (home, discovery, scan, history, campaigns/crawls) → Tasks 11–13; §6 (domain boundaries, `ConsumerChainPort`, Postgres projections) → Tasks 1–4, 6–9; §7 (purchase/redemption/voucher flows) → Tasks 5–9; §8 (transaction states, idempotency, error copy) → Tasks 1, 6, 11; §9 (security/auth/replay) → Tasks 5, 6, 8, 9; §10 (PWA/offline/a11y) → Task 14 + accessibility attributes threaded through Tasks 11–13; §11 (testing strategy) → every task's TDD steps; §12 (deterministic seed) → Task 14; §13 (acceptance journey) → Task 14 Step 7; §14 scope exclusions respected throughout (no contract/viem/relayer code, no offline mutation queue, no push notifications).
- **Placeholder scan:** no `TBD`, `TODO`, “remaining routes follow,” temporary asset, or untested-service marker remains. Every deferred write is represented by the typed `UNSUPPORTED_OPERATION` state until its named task replaces it.
- **Type consistency:** `ConsumerTransactionStatus` flows through `ChainSubmission`/`ChainTransactionStatus`; `UiTransactionState` adds only local `loading`/`awaiting_signature`. All three submit methods return `pending`; `getTransactionStatus` alone materializes terminal side effects. `RedemptionRequest` is shared by PUNCH and voucher paths. `progressFraction`'s `{ numerator, denominator }` shape is reused by dashboard and meter.
- **Corrections made during review:** demo address is isolated from production address map; café and consumer sign one final typed payload; mock pending→confirmed is observable and idempotent; authenticated API responses are excluded from Cache Storage; offline snapshots are user-scoped and cleared on logout; `/more` now matches approved navigation; deterministic seed clears prior demo fulfillment state.
