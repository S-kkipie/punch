# Pago de plan y packs del café — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un café active su plan de S/49, compre packs de S/40 y vea sus créditos y reserva desde su panel, sin ejecutar scripts.

**Architecture:** Módulo nuevo `src/core/plan/` que espeja `src/core/purchase/`. Una tabla `plan_order` que es orden y trabajo a la vez, con un runner propio en el worker que firma con el wallet custodial del miembro que paga: fondea mPEN vía el faucet público de MockPEN, aprueba al PlanManager y llama `subscribe`/`buyPack`. Los créditos ya los proyecta el indexer existente al ver `PlanActivated`/`PackPurchased`.

**Tech Stack:** Next.js 15 (App Router), Elysia + Eden, Drizzle ORM sobre Postgres, viem, TanStack Query, Vitest, Foundry/anvil.

**Spec:** `docs/superpowers/specs/2026-08-09-cafe-plan-payment-design.md`

## Global Constraints

- Nunca commitear `src/core/chain/addresses.local.json`. Nunca tocar `.env`.
- No tocar `src/core/chain/abis.ts`, `apply-event.ts`, `indexer.ts`, `relayer.ts`, `chain-schema.ts` ni `purchase-schema.ts`. Otras sesiones trabajan ahí en paralelo.
- No deployar a Arbitrum Sepolia.
- La mnemónica de anvil (`test test test test test test test test test test test junk`) es TEST-ONLY de la cadena 31337. Nunca exponerla en logs, respuestas de API ni bundles de cliente. Ningún endpoint devuelve índices HD, direcciones de firmante ni claves.
- Verificación siempre con DB fresca: crear DB → `pnpm db:migrate` → `pnpm db:seed` → anvil fresco en 31337 → `pnpm chain:deploy` → `pnpm chain:bootstrap-local`.
- Tests de integración gated con `PUNCH_RUN_INTEGRATION=1`; los de cadena viva además con `PUNCH_RUN_LIVE_CHAIN=1`.
- Postgres corre en docker `punch-pg`. Si hay `ETIMEDOUT`, `docker start punch-pg`.
- Todo archivo bajo `src/core/plan/server/` empieza con `import "server-only";`.
- Formato: `pnpm biome check --write <archivos>` antes de cada commit. Indentación de 4 espacios.
- Valores exactos del contrato: `PLAN_PRICE = 49e6`, `PACK_PRICE = 40e6`, `CREDITS_PER_PURCHASE = 100`, `RESERVE_PER_CREDIT = 300_000`, `PLAN_FUND_SHARE = 5e6`, `PLAN_TREASURY_SHARE = 14e6`, `PACK_FUND_SHARE = 5e6`, `PACK_TREASURY_SHARE = 5e6`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/core/plan/domain/types.ts` | Tipos del dominio: kind, status, motivos de fallo |
| `src/core/plan/domain/schemas.ts` | Constantes de precio y split, conversiones, esquemas zod |
| `src/core/plan/domain/transitions.ts` | Máquina de estados pura |
| `src/core/plan/domain/errors.ts` | Clasificación permanente/transitorio de errores de cadena |
| `src/server/drizzle/schemas/plan-schema.ts` | Tabla `plan_order` |
| `src/core/plan/server/repository/plan-repository.ts` | Inserción con guarda de orden en vuelo, claim con lease, marcadores de estado |
| `src/core/plan/server/repository/plan-chain-reader.ts` | Lecturas on-chain: `planActive`, `unallocatedReserve` |
| `src/core/plan/server/services/create-plan-order-service.ts` | Autorización, reglas de kind, anti doble cobro |
| `src/core/plan/server/services/get-plan-order-service.ts` | Una orden, para el polling |
| `src/core/plan/server/services/list-plan-orders-service.ts` | Historial del café |
| `src/core/plan/server/services/get-plan-status-service.ts` | Plan, créditos, reserva y si el usuario puede pagar |
| `src/core/plan/server/runner/funding.ts` | Fondeo de gas y mPEN, con guarda de entorno |
| `src/core/plan/server/runner/plan-runner.ts` | Ejecución de las órdenes |
| `src/core/plan/server/api/router.ts` + `routes/` | Endpoints bajo `/api/v1/plans` |
| `src/core/plan/client/hooks.ts` | Hooks de TanStack Query |
| `src/core/plan/client/ui/plan-card.tsx` | Estado del plan, split y botón de pago |
| `src/core/plan/client/ui/plan-history.tsx` | Historial de pagos |
| `src/core/plan/client/ui/credits-badge.tsx` | Indicador de créditos reutilizable |
| `src/app/(app)/(workspace)/cafe/[cafeId]/plan/page.tsx` | Página del plan |

---

### Task 1: Dominio puro

Sin base de datos, sin cadena. Todo lo que sigue depende de estos nombres.

**Files:**
- Create: `src/core/plan/domain/types.ts`
- Create: `src/core/plan/domain/schemas.ts`
- Create: `src/core/plan/domain/transitions.ts`
- Create: `src/core/plan/domain/errors.ts`
- Test: `src/core/plan/domain/__tests__/plan-domain.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `PlanOrderKind = "plan" | "pack"`
  - `PlanOrderStatus = "pending" | "submitted" | "confirmed" | "failed"`
  - `PlanFailureReason = "not_authorized" | "cafe_not_operational" | "plan_not_active" | "faucet_cap_exceeded" | "funding_unavailable" | "max_attempts" | "reverted"`
  - `PLAN_PRICE_MPEN: bigint`, `PACK_PRICE_MPEN: bigint`, `CREDITS_PER_PURCHASE: number`, `RESERVE_PER_CREDIT_MPEN: bigint`, `PLAN_SPLITS`
  - `priceForKind(kind: PlanOrderKind): bigint`
  - `mpenToSoles(value: bigint): number`
  - `createPlanOrderSchema`, `planOrderSchema`, `planStatusSchema`
  - `CreatePlanOrder`, `PlanOrderView`, `PlanStatusView`
  - `canTransition(from: PlanOrderStatus, to: PlanOrderStatus): boolean`
  - `isTerminal(status: PlanOrderStatus): boolean`
  - `classifyPlanError(error: unknown): { permanent: boolean; reason: PlanFailureReason | null }`
  - `MAX_PLAN_ATTEMPTS: number`, `backoffMs(attempts: number): number`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/core/plan/domain/__tests__/plan-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    backoffMs,
    classifyPlanError,
    MAX_PLAN_ATTEMPTS,
} from "../errors";
import {
    createPlanOrderSchema,
    mpenToSoles,
    PACK_PRICE_MPEN,
    PLAN_PRICE_MPEN,
    PLAN_SPLITS,
    priceForKind,
    RESERVE_PER_CREDIT_MPEN,
} from "../schemas";
import { canTransition, isTerminal } from "../transitions";

describe("plan pricing", () => {
    it("uses the contract prices", () => {
        expect(PLAN_PRICE_MPEN).toBe(49_000_000n);
        expect(PACK_PRICE_MPEN).toBe(40_000_000n);
        expect(priceForKind("plan")).toBe(PLAN_PRICE_MPEN);
        expect(priceForKind("pack")).toBe(PACK_PRICE_MPEN);
    });

    it("splits add up to the price", () => {
        const plan = PLAN_SPLITS.plan;
        expect(plan.reserve + plan.fund + plan.treasury).toBe(PLAN_PRICE_MPEN);
        const pack = PLAN_SPLITS.pack;
        expect(pack.reserve + pack.fund + pack.treasury).toBe(PACK_PRICE_MPEN);
        expect(plan.treasury).toBe(14_000_000n);
        expect(pack.treasury).toBe(5_000_000n);
    });

    it("converts mPEN to soles", () => {
        expect(mpenToSoles(49_000_000n)).toBe(49);
        expect(mpenToSoles(RESERVE_PER_CREDIT_MPEN)).toBe(0.3);
        expect(mpenToSoles(0n)).toBe(0);
    });

    it("rejects an unknown kind at the edge", () => {
        expect(createPlanOrderSchema.safeParse({ cafeId: "c1", kind: "plan" }).success).toBe(true);
        expect(createPlanOrderSchema.safeParse({ cafeId: "c1", kind: "gift" }).success).toBe(false);
        expect(createPlanOrderSchema.safeParse({ cafeId: "", kind: "pack" }).success).toBe(false);
    });
});

describe("plan order transitions", () => {
    it("allows the happy path", () => {
        expect(canTransition("pending", "submitted")).toBe(true);
        expect(canTransition("submitted", "confirmed")).toBe(true);
    });

    it("allows recovering a submitted order back to pending", () => {
        expect(canTransition("submitted", "pending")).toBe(true);
    });

    it("allows pending to confirm directly when a lost receipt reappears", () => {
        expect(canTransition("pending", "confirmed")).toBe(true);
    });

    it("treats confirmed and failed as terminal", () => {
        expect(isTerminal("confirmed")).toBe(true);
        expect(isTerminal("failed")).toBe(true);
        expect(isTerminal("pending")).toBe(false);
        expect(canTransition("confirmed", "pending")).toBe(false);
        expect(canTransition("failed", "submitted")).toBe(false);
    });
});

describe("plan error classification", () => {
    it("marks contract authorization reverts as permanent", () => {
        expect(classifyPlanError(new Error("NotAuthorizedForCafe(1, 0xabc)"))).toEqual({
            permanent: true,
            reason: "not_authorized",
        });
        expect(classifyPlanError(new Error("CafeNotOperational(1)"))).toEqual({
            permanent: true,
            reason: "cafe_not_operational",
        });
        expect(classifyPlanError(new Error("PlanNotActive(1)"))).toEqual({
            permanent: true,
            reason: "plan_not_active",
        });
        expect(classifyPlanError(new Error("FaucetCapExceeded(1, 2)"))).toEqual({
            permanent: true,
            reason: "faucet_cap_exceeded",
        });
    });

    it("marks funding unavailability as permanent", () => {
        expect(classifyPlanError(new Error("funding_unavailable"))).toEqual({
            permanent: true,
            reason: "funding_unavailable",
        });
    });

    it("treats rpc and nonce trouble as transient", () => {
        expect(classifyPlanError(new Error("fetch failed"))).toEqual({
            permanent: false,
            reason: null,
        });
        expect(classifyPlanError(new Error("nonce too low"))).toEqual({
            permanent: false,
            reason: null,
        });
    });

    it("backs off exponentially and caps", () => {
        expect(backoffMs(0)).toBe(2_000);
        expect(backoffMs(1)).toBe(4_000);
        expect(backoffMs(3)).toBe(16_000);
        expect(backoffMs(50)).toBe(60_000);
        expect(MAX_PLAN_ATTEMPTS).toBe(5);
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run src/core/plan/domain/__tests__/plan-domain.test.ts`
Expected: FAIL, "Failed to resolve import ../errors".

- [ ] **Step 3: Escribir `types.ts`**

```ts
export type PlanOrderKind = "plan" | "pack";

export type PlanOrderStatus = "pending" | "submitted" | "confirmed" | "failed";

export type PlanFailureReason =
    | "not_authorized"
    | "cafe_not_operational"
    | "plan_not_active"
    | "faucet_cap_exceeded"
    | "funding_unavailable"
    | "max_attempts"
    | "reverted";
```

- [ ] **Step 4: Escribir `schemas.ts`**

```ts
import { z } from "zod";
import type { PlanOrderKind } from "./types";

export const PLAN_PRICE_MPEN = 49_000_000n;
export const PACK_PRICE_MPEN = 40_000_000n;
export const CREDITS_PER_PURCHASE = 100;
export const RESERVE_PER_CREDIT_MPEN = 300_000n;
export const LOW_CREDITS_THRESHOLD = 10;

/** Mirrors PlanManager's constants. Reserve is the remainder the contract keeps. */
export const PLAN_SPLITS = {
    plan: { reserve: 30_000_000n, fund: 5_000_000n, treasury: 14_000_000n },
    pack: { reserve: 30_000_000n, fund: 5_000_000n, treasury: 5_000_000n },
} as const;

export const planOrderKindValues = ["plan", "pack"] as const;
export const planOrderStatusValues = [
    "pending",
    "submitted",
    "confirmed",
    "failed",
] as const;

export const planOrderKindSchema = z.enum(planOrderKindValues);
export const planOrderStatusSchema = z.enum(planOrderStatusValues);

export function priceForKind(kind: PlanOrderKind): bigint {
    return kind === "plan" ? PLAN_PRICE_MPEN : PACK_PRICE_MPEN;
}

export function mpenToSoles(value: bigint): number {
    return Number(value) / 1_000_000;
}

export const createPlanOrderSchema = z.object({
    cafeId: z.string().min(1),
    kind: planOrderKindSchema,
});

export const planOrderSchema = z.object({
    id: z.string(),
    cafeId: z.string(),
    kind: planOrderKindSchema,
    priceSoles: z.number().positive(),
    status: planOrderStatusSchema,
    failureReason: z.string().nullable(),
    txHash: z.string().nullable(),
    createdAt: z.iso.datetime(),
});

export const planStatusSchema = z.object({
    cafeId: z.string(),
    planActive: z.boolean(),
    credits: z.number().int().nonnegative(),
    unallocatedReserveSoles: z.number().nonnegative(),
    canPay: z.boolean(),
    inFlightOrderId: z.string().nullable(),
});
```

- [ ] **Step 5: Escribir `transitions.ts`**

```ts
import type { PlanOrderStatus } from "./types";

const edges: Record<PlanOrderStatus, PlanOrderStatus[]> = {
    // pending → confirmed is the lost-receipt recovery: the tx landed but the
    // write that recorded it did not.
    pending: ["submitted", "confirmed", "failed"],
    // submitted → pending is the expired-lease recovery.
    submitted: ["confirmed", "failed", "pending"],
    confirmed: [],
    failed: [],
};

export function canTransition(
    from: PlanOrderStatus,
    to: PlanOrderStatus,
): boolean {
    return edges[from].includes(to);
}

export function isTerminal(status: PlanOrderStatus): boolean {
    return edges[status].length === 0;
}
```

- [ ] **Step 6: Escribir `errors.ts`**

```ts
import type { PlanFailureReason } from "./types";

export const MAX_PLAN_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

const permanentMarkers: [string, PlanFailureReason][] = [
    ["NotAuthorizedForCafe", "not_authorized"],
    ["CafeNotOperational", "cafe_not_operational"],
    ["PlanNotActive", "plan_not_active"],
    ["FaucetCapExceeded", "faucet_cap_exceeded"],
    ["funding_unavailable", "funding_unavailable"],
];

export type PlanErrorClass = {
    permanent: boolean;
    reason: PlanFailureReason | null;
};

/**
 * Contract reverts that will fail again on every retry are permanent; anything
 * else (RPC, nonce, timeouts) gets another attempt.
 */
export function classifyPlanError(error: unknown): PlanErrorClass {
    const text =
        error instanceof Error ? `${error.message}` : String(error ?? "");
    for (const [marker, reason] of permanentMarkers) {
        if (text.includes(marker)) return { permanent: true, reason };
    }
    return { permanent: false, reason: null };
}

export function backoffMs(attempts: number): number {
    const delay = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts);
    return Math.min(delay, MAX_BACKOFF_MS);
}
```

- [ ] **Step 7: Completar `types.ts` con los tipos inferidos**

Añadir al final de `src/core/plan/domain/types.ts`:

```ts
import type { z } from "zod";
import type {
    createPlanOrderSchema,
    planOrderSchema,
    planStatusSchema,
} from "./schemas";

export type CreatePlanOrder = z.infer<typeof createPlanOrderSchema>;
export type PlanOrderView = z.infer<typeof planOrderSchema>;
export type PlanStatusView = z.infer<typeof planStatusSchema>;
```

- [ ] **Step 8: Correr el test para verificar que pasa**

Run: `pnpm vitest run src/core/plan/domain/__tests__/plan-domain.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 9: Commit**

```bash
pnpm biome check --write src/core/plan
git add src/core/plan
git commit -m "feat(plan): add plan payment domain rules"
```

---

### Task 2: Tabla `plan_order` y repositorio

**Files:**
- Create: `src/server/drizzle/schemas/plan-schema.ts`
- Modify: `src/server/drizzle/schemas/index.ts`
- Create: `src/core/plan/server/repository/plan-repository.ts`
- Test: `src/core/plan/server/repository/__tests__/plan-repository.integration.test.ts`

**Interfaces:**
- Consumes: `PlanOrderKind`, `PlanOrderStatus` de Task 1.
- Produces:
  - `planOrder`, `planOrderKind`, `planOrderStatus`, `PlanOrderRow` desde el schema.
  - `PLAN_CLAIM_LEASE_MS: number`
  - `insertOrderIfIdle(input): Promise<{ created: boolean; row: PlanOrderRow }>` donde `input` es `{ id, cafeId, chainCafeId, userId, kind, price, signerAddress, signerWalletIndex }`
  - `findOrder(id: string): Promise<PlanOrderRow | null>`
  - `findInFlightByCafe(cafeId: string): Promise<PlanOrderRow | null>`
  - `listOrdersByCafe(cafeId: string, limit?: number): Promise<PlanOrderRow[]>`
  - `findOrdersToRun(limit: number, leaseMs?: number): Promise<PlanOrderRow[]>`
  - `claimSubmittedOrders(limit: number, leaseMs?: number): Promise<PlanOrderRow[]>`
  - `markOrderSubmitted(id, txHash, nextRetryAt): Promise<PlanOrderRow | null>`
  - `markOrderConfirmed(id): Promise<PlanOrderRow | null>`
  - `markOrderRetry(id, error, attempts, nextRetryAt): Promise<PlanOrderRow | null>`
  - `markOrderFailed(id, error, failureReason): Promise<PlanOrderRow | null>`
  - `markOrderPending(id, nextRetryAt): Promise<PlanOrderRow | null>`
  - `planRepository` con todo lo anterior.

- [ ] **Step 1: Escribir el schema**

Crear `src/server/drizzle/schemas/plan-schema.ts`:

```ts
import { sql } from "drizzle-orm";
import {
    bigint,
    check,
    index,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { cafe } from "./cafe-schema";

export const planOrderKind = pgEnum("plan_order_kind", ["plan", "pack"]);

export const planOrderStatus = pgEnum("plan_order_status", [
    "pending",
    "submitted",
    "confirmed",
    "failed",
]);

export const planOrder = pgTable(
    "plan_order",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "restrict" }),
        // Snapshot so the runner never needs a join to build the call.
        chainCafeId: integer("chain_cafe_id").notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "restrict" }),
        kind: planOrderKind("kind").notNull(),
        // mPEN, 6 decimals: 49e6 for a plan, 40e6 for a pack.
        price: bigint("price", { mode: "bigint" }).notNull(),
        signerAddress: text("signer_address").notNull(),
        signerWalletIndex: integer("signer_wallet_index").notNull(),
        status: planOrderStatus("status").default("pending").notNull(),
        attempts: integer("attempts").default(0).notNull(),
        nextRetryAt: timestamp("next_retry_at").defaultNow().notNull(),
        txHash: text("tx_hash"),
        lastError: text("last_error"),
        failureReason: text("failure_reason"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (t) => [
        index("plan_order_cafe_created_idx").on(t.cafeId, t.createdAt),
        index("plan_order_status_retry_idx").on(t.status, t.nextRetryAt),
        // One payment in flight per cafe: a double click can never charge twice.
        uniqueIndex("plan_order_cafe_inflight_uq")
            .on(t.cafeId)
            .where(sql`${t.status} in ('pending', 'submitted')`),
        check("plan_order_price_positive", sql`${t.price} > 0`),
    ],
);

export type PlanOrderRow = typeof planOrder.$inferSelect;
```

- [ ] **Step 2: Registrar el schema**

En `src/server/drizzle/schemas/index.ts`, añadir la línea en orden alfabético (después de `./consumption-schema`):

```ts
export * from "./plan-schema";
```

- [ ] **Step 3: Generar la migración**

Run: `pnpm db:generate`
Expected: un archivo nuevo en `drizzle/` que crea `plan_order`, los dos enums y los índices. Abrirlo y confirmar que el único parcial trae el `WHERE`; si drizzle-kit lo omitió, añadirlo a mano al SQL generado:

```sql
CREATE UNIQUE INDEX "plan_order_cafe_inflight_uq" ON "plan_order" ("cafe_id")
WHERE "status" in ('pending', 'submitted');
```

- [ ] **Step 4: Escribir el test de integración que falla**

Crear `src/core/plan/server/repository/__tests__/plan-repository.integration.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { planOrder } from "@/server/drizzle/schemas/plan-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import {
    claimSubmittedOrders,
    findInFlightByCafe,
    findOrdersToRun,
    insertOrderIfIdle,
    markOrderConfirmed,
    markOrderFailed,
    markOrderPending,
    markOrderSubmitted,
} from "../plan-repository";

const runIntegration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!runIntegration);
installIntegrationDbMutex();

const created: string[] = [];

async function fixture() {
    const [seedUser] = await db.select({ id: user.id }).from(user).limit(1);
    const [seedCafe] = await db
        .select({ id: cafe.id, chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .limit(1);
    if (!seedUser || !seedCafe || seedCafe.chainCafeId === null) {
        throw new Error("plan repository test needs a seeded cafe with a chain id");
    }
    return { userId: seedUser.id, cafeId: seedCafe.id, chainCafeId: seedCafe.chainCafeId };
}

function newOrder(base: { userId: string; cafeId: string; chainCafeId: number }) {
    const id = crypto.randomUUID();
    created.push(id);
    return {
        id,
        cafeId: base.cafeId,
        chainCafeId: base.chainCafeId,
        userId: base.userId,
        kind: "plan" as const,
        price: 49_000_000n,
        signerAddress: "0x1111111111111111111111111111111111111111",
        signerWalletIndex: 7,
    };
}

describeIntegration("plan repository", () => {
    afterEach(async () => {
        for (const id of created.splice(0)) {
            await db.delete(planOrder).where(eq(planOrder.id, id));
        }
    });

    it("inserts an order when the cafe has none in flight", async () => {
        const base = await fixture();
        const result = await insertOrderIfIdle(newOrder(base));
        expect(result.created).toBe(true);
        expect(result.row.status).toBe("pending");
        expect(result.row.price).toBe(49_000_000n);
    });

    it("returns the existing order instead of charging twice", async () => {
        const base = await fixture();
        const first = await insertOrderIfIdle(newOrder(base));
        const second = await insertOrderIfIdle(newOrder(base));
        expect(second.created).toBe(false);
        expect(second.row.id).toBe(first.row.id);
        const inFlight = await findInFlightByCafe(base.cafeId);
        expect(inFlight?.id).toBe(first.row.id);
    });

    it("lets a new order in once the previous one is terminal", async () => {
        const base = await fixture();
        const first = await insertOrderIfIdle(newOrder(base));
        await markOrderConfirmed(first.row.id);
        const second = await insertOrderIfIdle(newOrder(base));
        expect(second.created).toBe(true);
        expect(second.row.id).not.toBe(first.row.id);
        expect(await findInFlightByCafe(base.cafeId)).not.toBeNull();
    });

    it("claims pending orders once and leases them", async () => {
        const base = await fixture();
        const order = await insertOrderIfIdle(newOrder(base));
        const firstClaim = await findOrdersToRun(10);
        expect(firstClaim.map((row) => row.id)).toContain(order.row.id);
        const secondClaim = await findOrdersToRun(10);
        expect(secondClaim.map((row) => row.id)).not.toContain(order.row.id);
    });

    it("moves a submitted order back to pending on recovery", async () => {
        const base = await fixture();
        const order = await insertOrderIfIdle(newOrder(base));
        await findOrdersToRun(10);
        await markOrderSubmitted(order.row.id, "0xabc", new Date(Date.now() - 1));
        const claimed = await claimSubmittedOrders(10);
        expect(claimed.map((row) => row.id)).toContain(order.row.id);
        const recovered = await markOrderPending(order.row.id, new Date());
        expect(recovered?.status).toBe("pending");
    });

    it("records a permanent failure with its reason", async () => {
        const base = await fixture();
        const order = await insertOrderIfIdle(newOrder(base));
        const failed = await markOrderFailed(
            order.row.id,
            "NotAuthorizedForCafe(1, 0x0)",
            "not_authorized",
        );
        expect(failed?.status).toBe("failed");
        expect(failed?.failureReason).toBe("not_authorized");
    });
});
```

- [ ] **Step 5: Correr el test para verificar que falla**

Run: `PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/plan/server/repository/__tests__/plan-repository.integration.test.ts`
Expected: FAIL, "Failed to resolve import ../plan-repository".

- [ ] **Step 6: Escribir el repositorio**

Crear `src/core/plan/server/repository/plan-repository.ts`:

```ts
import "server-only";

import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { PlanFailureReason, PlanOrderKind } from "@/core/plan/domain/types";
import { db } from "@/server/drizzle/db";
import {
    planOrder,
    type PlanOrderRow,
} from "@/server/drizzle/schemas/plan-schema";

export const PLAN_CLAIM_LEASE_MS = 60_000;
const IN_FLIGHT = ["pending", "submitted"] as const;

export type InsertPlanOrder = {
    id: string;
    cafeId: string;
    chainCafeId: number;
    userId: string;
    kind: PlanOrderKind;
    price: bigint;
    signerAddress: string;
    signerWalletIndex: number;
};

export async function findInFlightByCafe(
    cafeId: string,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .select()
        .from(planOrder)
        .where(
            and(
                eq(planOrder.cafeId, cafeId),
                inArray(planOrder.status, [...IN_FLIGHT]),
            ),
        )
        .limit(1);
    return row ?? null;
}

/**
 * Inserts unless the cafe already has a payment in flight. The partial unique
 * index is the real guard: two concurrent requests both reach the insert and
 * exactly one wins.
 */
export async function insertOrderIfIdle(
    input: InsertPlanOrder,
): Promise<{ created: boolean; row: PlanOrderRow }> {
    const [inserted] = await db
        .insert(planOrder)
        .values({
            ...input,
            signerAddress: input.signerAddress.toLowerCase(),
            status: "pending",
        })
        .onConflictDoNothing({
            target: planOrder.cafeId,
            targetWhere: sql`status in ('pending', 'submitted')`,
        })
        .returning();
    if (inserted) return { created: true, row: inserted };
    const existing = await findInFlightByCafe(input.cafeId);
    if (!existing) throw new Error("plan order insert lost a race with no winner");
    return { created: false, row: existing };
}

export async function findOrder(id: string): Promise<PlanOrderRow | null> {
    const [row] = await db
        .select()
        .from(planOrder)
        .where(eq(planOrder.id, id))
        .limit(1);
    return row ?? null;
}

export async function listOrdersByCafe(
    cafeId: string,
    limit = 50,
): Promise<PlanOrderRow[]> {
    return db
        .select()
        .from(planOrder)
        .where(eq(planOrder.cafeId, cafeId))
        .orderBy(desc(planOrder.createdAt))
        .limit(limit);
}

async function claimByStatus(
    status: PlanOrderRow["status"],
    limit: number,
    leaseMs = PLAN_CLAIM_LEASE_MS,
): Promise<PlanOrderRow[]> {
    if (limit <= 0) return [];
    return db.transaction(async (tx) => {
        const due = await tx
            .select()
            .from(planOrder)
            .where(
                and(
                    eq(planOrder.status, status),
                    lte(planOrder.nextRetryAt, new Date()),
                ),
            )
            .limit(limit)
            .for("update", { skipLocked: true });
        if (due.length === 0) return [];
        const leaseUntil = new Date(Date.now() + leaseMs);
        return tx
            .update(planOrder)
            .set({ nextRetryAt: leaseUntil })
            .where(
                inArray(
                    planOrder.id,
                    due.map((row) => row.id),
                ),
            )
            .returning();
    });
}

export async function findOrdersToRun(
    limit: number,
    leaseMs = PLAN_CLAIM_LEASE_MS,
): Promise<PlanOrderRow[]> {
    return claimByStatus("pending", limit, leaseMs);
}

export async function claimSubmittedOrders(
    limit: number,
    leaseMs = PLAN_CLAIM_LEASE_MS,
): Promise<PlanOrderRow[]> {
    return claimByStatus("submitted", limit, leaseMs);
}

export async function markOrderSubmitted(
    id: string,
    txHash: string,
    nextRetryAt: Date,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ status: "submitted", txHash, lastError: null, nextRetryAt })
        .where(and(eq(planOrder.id, id), eq(planOrder.status, "pending")))
        .returning();
    return row ?? null;
}

export async function markOrderConfirmed(
    id: string,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ status: "confirmed", lastError: null, failureReason: null })
        .where(
            and(
                eq(planOrder.id, id),
                inArray(planOrder.status, [...IN_FLIGHT]),
            ),
        )
        .returning();
    return row ?? null;
}

export async function markOrderRetry(
    id: string,
    error: string,
    attempts: number,
    nextRetryAt: Date,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ status: "pending", lastError: error, attempts, nextRetryAt })
        .where(
            and(
                eq(planOrder.id, id),
                inArray(planOrder.status, [...IN_FLIGHT]),
            ),
        )
        .returning();
    return row ?? null;
}

export async function markOrderFailed(
    id: string,
    error: string,
    failureReason: PlanFailureReason,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ status: "failed", lastError: error, failureReason })
        .where(
            and(
                eq(planOrder.id, id),
                inArray(planOrder.status, [...IN_FLIGHT]),
            ),
        )
        .returning();
    return row ?? null;
}

export async function markOrderPending(
    id: string,
    nextRetryAt: Date,
): Promise<PlanOrderRow | null> {
    const [row] = await db
        .update(planOrder)
        .set({ status: "pending", nextRetryAt })
        .where(
            and(
                eq(planOrder.id, id),
                inArray(planOrder.status, [...IN_FLIGHT]),
            ),
        )
        .returning();
    return row ?? null;
}

export const planRepository = {
    insertOrderIfIdle,
    findOrder,
    findInFlightByCafe,
    listOrdersByCafe,
    findOrdersToRun,
    claimSubmittedOrders,
    markOrderSubmitted,
    markOrderConfirmed,
    markOrderRetry,
    markOrderFailed,
    markOrderPending,
};
```

- [ ] **Step 7: Aplicar la migración sobre una DB fresca y correr el test**

```bash
docker start punch-pg
createdb -h 127.0.0.1 -U punch punch_plan_$(date +%s)   # o el flujo de DB fresca del proyecto
pnpm db:migrate
pnpm db:seed
PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/plan/server/repository/__tests__/plan-repository.integration.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
pnpm biome check --write src/core/plan src/server/drizzle/schemas
git add src/core/plan src/server/drizzle/schemas drizzle
git commit -m "feat(plan): add plan_order table and repository"
```

---

### Task 3: Lectura de estado on-chain y servicio de estado

**Files:**
- Create: `src/core/plan/server/repository/plan-chain-reader.ts`
- Create: `src/core/plan/server/services/get-plan-status-service.ts`
- Test: `src/core/plan/server/services/__tests__/get-plan-status-service.test.ts`

**Interfaces:**
- Consumes: `planStatusSchema`, `mpenToSoles`, `CREDITS_PER_PURCHASE` de Task 1; `findInFlightByCafe` de Task 2; `isAuthorizedCafeOperator` de `@/core/chain/server/cafe-authorization`.
- Produces:
  - `readPlanChainState(chainCafeId: number, deps?): Promise<{ planActive: boolean; unallocatedReserve: bigint }>`
  - `findCafeMembership(userId: string, cafeId: string): Promise<{ chainCafeId: number | null; walletAddress: string | null } | null>`
  - `getPlanStatusService(userId: string, cafeId: string, deps?): AsyncAppResult<PlanStatusView>`
  - `PlanStatusDeps` con las llaves `findCafeMembership`, `readChainState`, `readCredits`, `isAuthorized`, `findInFlight`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/core/plan/server/services/__tests__/get-plan-status-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getPlanStatusService } from "../get-plan-status-service";

const membership = {
    chainCafeId: 1,
    walletAddress: "0x2222222222222222222222222222222222222222",
};

function deps(overrides = {}) {
    return {
        findCafeMembership: vi.fn().mockResolvedValue(membership),
        readChainState: vi
            .fn()
            .mockResolvedValue({ planActive: true, unallocatedReserve: 30_000_000n }),
        readCredits: vi.fn().mockResolvedValue(100n),
        isAuthorized: vi.fn().mockResolvedValue(true),
        findInFlight: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
}

describe("getPlanStatusService", () => {
    it("reports plan, credits and reserve", async () => {
        const result = await getPlanStatusService("u1", "c1", deps());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data).toEqual({
            cafeId: "c1",
            planActive: true,
            credits: 100,
            unallocatedReserveSoles: 30,
            canPay: true,
            inFlightOrderId: null,
        });
    });

    it("reports zero credits when the projection has no row yet", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({ readCredits: vi.fn().mockResolvedValue(null) }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.credits).toBe(0);
    });

    it("says the user cannot pay when the wallet is not authorized on chain", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({ isAuthorized: vi.fn().mockResolvedValue(false) }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.canPay).toBe(false);
    });

    it("surfaces the order in flight", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({ findInFlight: vi.fn().mockResolvedValue({ id: "o1" }) }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.inFlightOrderId).toBe("o1");
    });

    it("rejects a user who is not a member", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({ findCafeMembership: vi.fn().mockResolvedValue(null) }),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(404);
    });

    it("rejects a cafe that is not on chain yet", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({
                findCafeMembership: vi
                    .fn()
                    .mockResolvedValue({ chainCafeId: null, walletAddress: membership.walletAddress }),
            }),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(422);
    });

    it("cannot pay without an assigned wallet", async () => {
        const result = await getPlanStatusService(
            "u1",
            "c1",
            deps({
                findCafeMembership: vi
                    .fn()
                    .mockResolvedValue({ chainCafeId: 1, walletAddress: null }),
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.canPay).toBe(false);
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run src/core/plan/server/services/__tests__/get-plan-status-service.test.ts`
Expected: FAIL, "Failed to resolve import ../get-plan-status-service".

- [ ] **Step 3: Escribir el lector de cadena**

Crear `src/core/plan/server/repository/plan-chain-reader.ts`:

```ts
import "server-only";

import type { PublicClient } from "viem";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";

export type PlanChainState = {
    planActive: boolean;
    unallocatedReserve: bigint;
};

export type PlanChainReaderDeps = {
    publicClient: Pick<PublicClient, "readContract">;
};

export async function readPlanChainState(
    chainCafeId: number,
    deps?: PlanChainReaderDeps,
): Promise<PlanChainState> {
    const publicClient = deps?.publicClient ?? createChainPublicClient();
    const address = getAddresses().planManager;
    const [planActive, unallocatedReserve] = await Promise.all([
        publicClient.readContract({
            address,
            abi: abis.planManager,
            functionName: "planActive",
            args: [BigInt(chainCafeId)],
        }) as Promise<boolean>,
        publicClient.readContract({
            address,
            abi: abis.planManager,
            functionName: "unallocatedReserve",
            args: [BigInt(chainCafeId)],
        }) as Promise<bigint>,
    ]);
    return { planActive, unallocatedReserve };
}
```

- [ ] **Step 4: Escribir el servicio de estado**

Crear `src/core/plan/server/services/get-plan-status-service.ts`:

```ts
import "server-only";

import { and, eq } from "drizzle-orm";
import { isAuthorizedCafeOperator } from "@/core/chain/server/cafe-authorization";
import { mpenToSoles } from "@/core/plan/domain/schemas";
import type { PlanStatusView } from "@/core/plan/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe, cafeMember } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCafeCredit } from "@/server/drizzle/schemas/chain-schema";
import { findInFlightByCafe } from "../repository/plan-repository";
import { readPlanChainState } from "../repository/plan-chain-reader";

export type CafeMembership = {
    chainCafeId: number | null;
    walletAddress: string | null;
};

export async function findCafeMembership(
    userId: string,
    cafeId: string,
): Promise<CafeMembership | null> {
    const [row] = await db
        .select({
            chainCafeId: cafe.chainCafeId,
            walletAddress: user.walletAddress,
        })
        .from(cafeMember)
        .innerJoin(cafe, eq(cafe.id, cafeMember.cafeId))
        .innerJoin(user, eq(user.id, cafeMember.userId))
        .where(and(eq(cafeMember.userId, userId), eq(cafeMember.cafeId, cafeId)))
        .limit(1);
    return row ?? null;
}

async function readCredits(chainCafeId: number): Promise<bigint | null> {
    const [row] = await db
        .select({ credits: projectionCafeCredit.credits })
        .from(projectionCafeCredit)
        .where(eq(projectionCafeCredit.chainCafeId, chainCafeId))
        .limit(1);
    return row?.credits ?? null;
}

export type PlanStatusDeps = {
    findCafeMembership: typeof findCafeMembership;
    readChainState: (chainCafeId: number) => Promise<{
        planActive: boolean;
        unallocatedReserve: bigint;
    }>;
    readCredits: (chainCafeId: number) => Promise<bigint | null>;
    isAuthorized: (input: {
        chainCafeId: number;
        walletAddress: `0x${string}`;
    }) => Promise<boolean>;
    findInFlight: (cafeId: string) => Promise<{ id: string } | null>;
};

const defaults: PlanStatusDeps = {
    findCafeMembership,
    readChainState: (chainCafeId) => readPlanChainState(chainCafeId),
    readCredits,
    isAuthorized: isAuthorizedCafeOperator,
    findInFlight: findInFlightByCafe,
};

export async function getPlanStatusService(
    userId: string,
    cafeId: string,
    overrides: Partial<PlanStatusDeps> = {},
): AsyncAppResult<PlanStatusView> {
    const d = { ...defaults, ...overrides };
    try {
        const membership = await d.findCafeMembership(userId, cafeId);
        if (!membership) return err(AppErrors.notFound({ targets: ["cafeId"] }));
        const { chainCafeId, walletAddress } = membership;
        if (chainCafeId === null) {
            return err(AppErrors.unprocessableEntity({ targets: ["cafeId"] }));
        }

        const [chainState, credits, inFlight] = await Promise.all([
            d.readChainState(chainCafeId),
            d.readCredits(chainCafeId),
            d.findInFlight(cafeId),
        ]);
        const canPay = walletAddress
            ? await d.isAuthorized({
                  chainCafeId,
                  walletAddress: walletAddress as `0x${string}`,
              })
            : false;

        return ok({
            cafeId,
            planActive: chainState.planActive,
            credits: Number(credits ?? 0n),
            unallocatedReserveSoles: mpenToSoles(chainState.unallocatedReserve),
            canPay,
            inFlightOrderId: inFlight?.id ?? null,
        });
    } catch {
        return err(AppErrors.unexpected(new Error("plan status lookup failed")));
    }
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `pnpm vitest run src/core/plan/server/services/__tests__/get-plan-status-service.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
pnpm biome check --write src/core/plan
git add src/core/plan
git commit -m "feat(plan): read plan status from chain and projection"
```

---

### Task 4: Crear la orden

**Files:**
- Create: `src/core/plan/server/services/create-plan-order-service.ts`
- Create: `src/core/plan/server/services/plan-view.ts`
- Create: `src/core/plan/server/services/get-plan-order-service.ts`
- Create: `src/core/plan/server/services/list-plan-orders-service.ts`
- Test: `src/core/plan/server/services/__tests__/create-plan-order-service.test.ts`

**Interfaces:**
- Consumes: `priceForKind` de Task 1; `insertOrderIfIdle`, `findOrder`, `listOrdersByCafe` de Task 2; `findCafeMembership` de Task 3; `assignWallet` de `@/core/chain/server/wallet/assign-wallet`.
- Produces:
  - `toPlanOrderView(row: PlanOrderRow): PlanOrderView` en `plan-view.ts`
  - `createPlanOrderService(userId: string, input: CreatePlanOrder, deps?): AsyncAppResult<PlanOrderView>`
  - `getPlanOrderService(userId: string, orderId: string, deps?): AsyncAppResult<PlanOrderView>`
  - `listPlanOrdersService(userId: string, cafeId: string, deps?): AsyncAppResult<PlanOrderView[]>`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/core/plan/server/services/__tests__/create-plan-order-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPlanOrderService } from "../create-plan-order-service";

const row = {
    id: "o1",
    cafeId: "c1",
    chainCafeId: 1,
    userId: "u1",
    kind: "plan" as const,
    price: 49_000_000n,
    signerAddress: "0x2222222222222222222222222222222222222222",
    signerWalletIndex: 3,
    status: "pending" as const,
    attempts: 0,
    nextRetryAt: new Date("2026-08-09T00:00:00Z"),
    txHash: null,
    lastError: null,
    failureReason: null,
    createdAt: new Date("2026-08-09T00:00:00Z"),
    updatedAt: new Date("2026-08-09T00:00:00Z"),
};

function deps(overrides = {}) {
    return {
        findCafeMembership: vi.fn().mockResolvedValue({
            chainCafeId: 1,
            walletAddress: "0x2222222222222222222222222222222222222222",
        }),
        readChainState: vi
            .fn()
            .mockResolvedValue({ planActive: false, unallocatedReserve: 0n }),
        isAuthorized: vi.fn().mockResolvedValue(true),
        ensureWallet: vi.fn().mockResolvedValue({
            walletIndex: 3,
            address: "0x2222222222222222222222222222222222222222",
        }),
        insertOrderIfIdle: vi.fn().mockResolvedValue({ created: true, row }),
        ...overrides,
    };
}

describe("createPlanOrderService", () => {
    it("creates a plan order for an authorized member", async () => {
        const d = deps();
        const result = await createPlanOrderService("u1", { cafeId: "c1", kind: "plan" }, d);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.priceSoles).toBe(49);
        expect(result.data.status).toBe("pending");
        expect(d.insertOrderIfIdle).toHaveBeenCalledWith(
            expect.objectContaining({
                cafeId: "c1",
                chainCafeId: 1,
                kind: "plan",
                price: 49_000_000n,
                signerWalletIndex: 3,
            }),
        );
    });

    it("charges the pack price for a pack", async () => {
        const d = deps({
            readChainState: vi
                .fn()
                .mockResolvedValue({ planActive: true, unallocatedReserve: 0n }),
            insertOrderIfIdle: vi
                .fn()
                .mockResolvedValue({ created: true, row: { ...row, kind: "pack", price: 40_000_000n } }),
        });
        const result = await createPlanOrderService("u1", { cafeId: "c1", kind: "pack" }, d);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.priceSoles).toBe(40);
    });

    it("rejects a pack when the plan is not active", async () => {
        const result = await createPlanOrderService("u1", { cafeId: "c1", kind: "pack" }, deps());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(422);
    });

    it("rejects a plan when the plan is already active", async () => {
        const d = deps({
            readChainState: vi
                .fn()
                .mockResolvedValue({ planActive: true, unallocatedReserve: 0n }),
        });
        const result = await createPlanOrderService("u1", { cafeId: "c1", kind: "plan" }, d);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(422);
    });

    it("rejects a non member", async () => {
        const d = deps({ findCafeMembership: vi.fn().mockResolvedValue(null) });
        const result = await createPlanOrderService("u1", { cafeId: "c1", kind: "plan" }, d);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(404);
    });

    it("rejects a member whose wallet is not authorized on chain", async () => {
        const d = deps({ isAuthorized: vi.fn().mockResolvedValue(false) });
        const result = await createPlanOrderService("u1", { cafeId: "c1", kind: "plan" }, d);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(403);
    });

    it("returns a conflict when a payment is already in flight", async () => {
        const d = deps({
            insertOrderIfIdle: vi.fn().mockResolvedValue({ created: false, row }),
        });
        const result = await createPlanOrderService("u1", { cafeId: "c1", kind: "plan" }, d);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.status).toBe(409);
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run src/core/plan/server/services/__tests__/create-plan-order-service.test.ts`
Expected: FAIL, "Failed to resolve import ../create-plan-order-service".

- [ ] **Step 3: Escribir `plan-view.ts`**

```ts
import "server-only";

import { mpenToSoles } from "@/core/plan/domain/schemas";
import type { PlanOrderView } from "@/core/plan/domain/types";
import type { PlanOrderRow } from "@/server/drizzle/schemas/plan-schema";

export function toPlanOrderView(row: PlanOrderRow): PlanOrderView {
    return {
        id: row.id,
        cafeId: row.cafeId,
        kind: row.kind,
        priceSoles: mpenToSoles(row.price),
        status: row.status,
        failureReason: row.failureReason,
        txHash: row.txHash,
        createdAt: row.createdAt.toISOString(),
    };
}
```

- [ ] **Step 4: Escribir `create-plan-order-service.ts`**

```ts
import "server-only";

import { isAuthorizedCafeOperator } from "@/core/chain/server/cafe-authorization";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { priceForKind } from "@/core/plan/domain/schemas";
import type { CreatePlanOrder, PlanOrderView } from "@/core/plan/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { readPlanChainState } from "../repository/plan-chain-reader";
import { insertOrderIfIdle } from "../repository/plan-repository";
import { findCafeMembership } from "./get-plan-status-service";
import { toPlanOrderView } from "./plan-view";

export type CreatePlanOrderDeps = {
    findCafeMembership: typeof findCafeMembership;
    readChainState: (chainCafeId: number) => Promise<{
        planActive: boolean;
        unallocatedReserve: bigint;
    }>;
    isAuthorized: (input: {
        chainCafeId: number;
        walletAddress: `0x${string}`;
    }) => Promise<boolean>;
    ensureWallet: typeof assignWallet;
    insertOrderIfIdle: typeof insertOrderIfIdle;
};

const defaults: CreatePlanOrderDeps = {
    findCafeMembership,
    readChainState: (chainCafeId) => readPlanChainState(chainCafeId),
    isAuthorized: isAuthorizedCafeOperator,
    ensureWallet: assignWallet,
    insertOrderIfIdle,
};

export async function createPlanOrderService(
    userId: string,
    input: CreatePlanOrder,
    overrides: Partial<CreatePlanOrderDeps> = {},
): AsyncAppResult<PlanOrderView> {
    const d = { ...defaults, ...overrides };
    try {
        const membership = await d.findCafeMembership(userId, input.cafeId);
        if (!membership) return err(AppErrors.notFound({ targets: ["cafeId"] }));
        if (membership.chainCafeId === null) {
            return err(AppErrors.unprocessableEntity({ targets: ["cafeId"] }));
        }
        const chainCafeId = membership.chainCafeId;

        const wallet = await d.ensureWallet(userId);
        const authorized = await d.isAuthorized({
            chainCafeId,
            walletAddress: wallet.address as `0x${string}`,
        });
        if (!authorized) return err(AppErrors.forbidden());

        // The contract enforces these too; checking here turns a wasted
        // transaction into a clear message.
        const { planActive } = await d.readChainState(chainCafeId);
        if (input.kind === "pack" && !planActive) {
            return err(AppErrors.unprocessableEntity({ targets: ["kind"] }));
        }
        if (input.kind === "plan" && planActive) {
            return err(AppErrors.unprocessableEntity({ targets: ["kind"] }));
        }

        const result = await d.insertOrderIfIdle({
            id: crypto.randomUUID(),
            cafeId: input.cafeId,
            chainCafeId,
            userId,
            kind: input.kind,
            price: priceForKind(input.kind),
            signerAddress: wallet.address,
            signerWalletIndex: wallet.walletIndex,
        });
        if (!result.created) {
            return err(AppErrors.conflict({ targets: ["cafeId"] }));
        }
        return ok(toPlanOrderView(result.row));
    } catch {
        return err(AppErrors.unexpected(new Error("plan order creation failed")));
    }
}
```

- [ ] **Step 5: Escribir `get-plan-order-service.ts`**

```ts
import "server-only";

import type { PlanOrderView } from "@/core/plan/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findOrder } from "../repository/plan-repository";
import { findCafeMembership } from "./get-plan-status-service";
import { toPlanOrderView } from "./plan-view";

export type GetPlanOrderDeps = {
    findOrder: typeof findOrder;
    findCafeMembership: typeof findCafeMembership;
};

const defaults: GetPlanOrderDeps = { findOrder, findCafeMembership };

export async function getPlanOrderService(
    userId: string,
    orderId: string,
    overrides: Partial<GetPlanOrderDeps> = {},
): AsyncAppResult<PlanOrderView> {
    const d = { ...defaults, ...overrides };
    try {
        const row = await d.findOrder(orderId);
        if (!row) return err(AppErrors.notFound({ targets: ["orderId"] }));
        const membership = await d.findCafeMembership(userId, row.cafeId);
        if (!membership) return err(AppErrors.notFound({ targets: ["orderId"] }));
        return ok(toPlanOrderView(row));
    } catch {
        return err(AppErrors.unexpected(new Error("plan order lookup failed")));
    }
}
```

- [ ] **Step 6: Escribir `list-plan-orders-service.ts`**

```ts
import "server-only";

import type { PlanOrderView } from "@/core/plan/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { listOrdersByCafe } from "../repository/plan-repository";
import { findCafeMembership } from "./get-plan-status-service";
import { toPlanOrderView } from "./plan-view";

export type ListPlanOrdersDeps = {
    listOrdersByCafe: typeof listOrdersByCafe;
    findCafeMembership: typeof findCafeMembership;
};

const defaults: ListPlanOrdersDeps = { listOrdersByCafe, findCafeMembership };

export async function listPlanOrdersService(
    userId: string,
    cafeId: string,
    overrides: Partial<ListPlanOrdersDeps> = {},
): AsyncAppResult<PlanOrderView[]> {
    const d = { ...defaults, ...overrides };
    try {
        const membership = await d.findCafeMembership(userId, cafeId);
        if (!membership) return err(AppErrors.notFound({ targets: ["cafeId"] }));
        const rows = await d.listOrdersByCafe(cafeId);
        return ok(rows.map(toPlanOrderView));
    } catch {
        return err(AppErrors.unexpected(new Error("plan order list failed")));
    }
}
```

- [ ] **Step 7: Correr el test para verificar que pasa**

Run: `pnpm vitest run src/core/plan/server/services/__tests__/create-plan-order-service.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Commit**

```bash
pnpm biome check --write src/core/plan
git add src/core/plan
git commit -m "feat(plan): create and read plan orders"
```

---

### Task 5: Fondeo con guarda de entorno

**Files:**
- Create: `src/core/plan/server/runner/funding.ts`
- Test: `src/core/plan/server/runner/__tests__/funding.test.ts`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  - `MIN_GAS_WEI: bigint`, `GAS_TOPUP_WEI: bigint`
  - `FundingUnavailableError` (mensaje exacto `funding_unavailable`)
  - `ensureGas(signer: \`0x${string}\`, deps?: Partial<FundingDeps>): Promise<void>`
  - `ensureMpen(input: { account: HDAccount; price: bigint }, deps?: Partial<FundingDeps>): Promise<void>`
  - `FundingDeps` con `chainEnv`, `getBalance`, `readAllowance`, `readMpenBalance`, `sendGas`, `callFaucet`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/core/plan/server/runner/__tests__/funding.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
    ensureGas,
    ensureMpen,
    FundingUnavailableError,
    GAS_TOPUP_WEI,
    MIN_GAS_WEI,
} from "../funding";

const signer = "0x3333333333333333333333333333333333333333" as const;
const account = { address: signer } as never;

describe("ensureGas", () => {
    it("tops up a signer below the minimum", async () => {
        const sendGas = vi.fn().mockResolvedValue(undefined);
        await ensureGas(signer, {
            chainEnv: "local",
            getBalance: vi.fn().mockResolvedValue(0n),
            sendGas,
        });
        expect(sendGas).toHaveBeenCalledWith(signer, GAS_TOPUP_WEI);
    });

    it("leaves a funded signer alone", async () => {
        const sendGas = vi.fn();
        await ensureGas(signer, {
            chainEnv: "local",
            getBalance: vi.fn().mockResolvedValue(MIN_GAS_WEI * 2n),
            sendGas,
        });
        expect(sendGas).not.toHaveBeenCalled();
    });

    it("refuses to fund outside the local chain", async () => {
        await expect(
            ensureGas(signer, {
                chainEnv: "arbitrumSepolia",
                getBalance: vi.fn().mockResolvedValue(0n),
                sendGas: vi.fn(),
            }),
        ).rejects.toBeInstanceOf(FundingUnavailableError);
    });
});

describe("ensureMpen", () => {
    it("calls the faucet for the missing amount only", async () => {
        const callFaucet = vi.fn().mockResolvedValue(undefined);
        await ensureMpen(
            { account, price: 49_000_000n },
            {
                chainEnv: "local",
                readMpenBalance: vi.fn().mockResolvedValue(0n),
                callFaucet,
            },
        );
        expect(callFaucet).toHaveBeenCalledWith(account, 49_000_000n);
    });

    it("skips the faucet when the signer already holds enough", async () => {
        const callFaucet = vi.fn();
        await ensureMpen(
            { account, price: 49_000_000n },
            {
                chainEnv: "local",
                readMpenBalance: vi.fn().mockResolvedValue(60_000_000n),
                callFaucet,
            },
        );
        expect(callFaucet).not.toHaveBeenCalled();
    });

    it("refuses to mint outside the local chain", async () => {
        await expect(
            ensureMpen(
                { account, price: 49_000_000n },
                {
                    chainEnv: "arbitrumSepolia",
                    readMpenBalance: vi.fn().mockResolvedValue(0n),
                    callFaucet: vi.fn(),
                },
            ),
        ).rejects.toBeInstanceOf(FundingUnavailableError);
    });

    it("carries the funding_unavailable marker in its message", () => {
        expect(new FundingUnavailableError().message).toBe("funding_unavailable");
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run src/core/plan/server/runner/__tests__/funding.test.ts`
Expected: FAIL, "Failed to resolve import ../funding".

- [ ] **Step 3: Escribir `funding.ts`**

```ts
import "server-only";

import { type Address, parseEther } from "viem";
import { type HDAccount, mnemonicToAccount } from "viem/accounts";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import {
    createChainPublicClient,
    createChainWalletClient,
} from "@/core/chain/chain";
import { env } from "@/config/env";

export const MIN_GAS_WEI = parseEther("0.01");
export const GAS_TOPUP_WEI = parseEther("0.1");

/**
 * Anvil's well-known development mnemonic. Test-only, chain 31337: it funds gas
 * for custodial signers on the local chain and is never used anywhere else.
 */
const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk";

export class FundingUnavailableError extends Error {
    constructor() {
        super("funding_unavailable");
        this.name = "FundingUnavailableError";
    }
}

export type FundingDeps = {
    chainEnv: string;
    getBalance: (address: Address) => Promise<bigint>;
    readMpenBalance: (address: Address) => Promise<bigint>;
    sendGas: (to: Address, value: bigint) => Promise<void>;
    callFaucet: (account: HDAccount, amount: bigint) => Promise<void>;
};

function localFunder(): HDAccount {
    return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 0 });
}

const defaults: FundingDeps = {
    chainEnv: env.CHAIN_ENV,
    getBalance: async (address) =>
        createChainPublicClient().getBalance({ address }),
    readMpenBalance: async (address) =>
        createChainPublicClient().readContract({
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [address],
        }) as Promise<bigint>,
    sendGas: async (to, value) => {
        const funder = localFunder();
        const wallet = createChainWalletClient(undefined, funder);
        const hash = await wallet.sendTransaction({
            account: funder,
            chain: null,
            to,
            value,
        });
        await createChainPublicClient().waitForTransactionReceipt({ hash });
    },
    callFaucet: async (account, amount) => {
        const wallet = createChainWalletClient(undefined, account);
        const hash = await wallet.writeContract({
            account,
            chain: null,
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "faucet",
            args: [amount],
        });
        await createChainPublicClient().waitForTransactionReceipt({ hash });
    },
};

function requireLocal(chainEnv: string) {
    if (chainEnv !== "local") throw new FundingUnavailableError();
}

export async function ensureGas(
    signer: Address,
    overrides: Partial<FundingDeps> = {},
): Promise<void> {
    const d = { ...defaults, ...overrides };
    const balance = await d.getBalance(signer);
    if (balance >= MIN_GAS_WEI) return;
    requireLocal(d.chainEnv);
    await d.sendGas(signer, GAS_TOPUP_WEI);
}

export async function ensureMpen(
    input: { account: HDAccount; price: bigint },
    overrides: Partial<FundingDeps> = {},
): Promise<void> {
    const d = { ...defaults, ...overrides };
    const balance = await d.readMpenBalance(input.account.address);
    if (balance >= input.price) return;
    requireLocal(d.chainEnv);
    await d.callFaucet(input.account, input.price);
}
```

Nota: `ensureGas` y `ensureMpen` leen el balance **antes** de la guarda de entorno. Un firmante ya fondeado funciona en cualquier entorno; solo fondear exige cadena local.

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm vitest run src/core/plan/server/runner/__tests__/funding.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verificar que la mnemónica no llega al cliente**

Run: `grep -rn "test test test" src/core/plan/client src/app || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
pnpm biome check --write src/core/plan
git add src/core/plan
git commit -m "feat(plan): fund local signers for plan payments"
```

---

### Task 6: El runner

**Files:**
- Create: `src/core/plan/server/runner/plan-runner.ts`
- Test: `src/core/plan/server/runner/__tests__/plan-runner.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2 y 5.
- Produces:
  - `runPlanRunnerOnce(deps?: Partial<PlanRunnerDeps>): Promise<void>`
  - `recoverStuckPlanOrders(deps?: Partial<PlanRunnerDeps>): Promise<void>`
  - `PLAN_BATCH_SIZE: number`
  - `PlanRunnerDeps` con `findOrdersToRun`, `claimSubmittedOrders`, `markOrderSubmitted`, `markOrderConfirmed`, `markOrderRetry`, `markOrderFailed`, `markOrderPending`, `deriveAccount`, `ensureGas`, `ensureMpen`, `readAllowance`, `approve`, `execute`, `waitForReceipt`, `now`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/core/plan/server/runner/__tests__/plan-runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runPlanRunnerOnce } from "../plan-runner";

const order = {
    id: "o1",
    cafeId: "c1",
    chainCafeId: 1,
    userId: "u1",
    kind: "plan" as const,
    price: 49_000_000n,
    signerAddress: "0x3333333333333333333333333333333333333333",
    signerWalletIndex: 3,
    status: "pending" as const,
    attempts: 0,
    nextRetryAt: new Date(),
    txHash: null,
    lastError: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

function deps(overrides = {}) {
    return {
        findOrdersToRun: vi.fn().mockResolvedValue([order]),
        claimSubmittedOrders: vi.fn().mockResolvedValue([]),
        markOrderSubmitted: vi.fn().mockResolvedValue(order),
        markOrderConfirmed: vi.fn().mockResolvedValue(order),
        markOrderRetry: vi.fn().mockResolvedValue(order),
        markOrderFailed: vi.fn().mockResolvedValue(order),
        markOrderPending: vi.fn().mockResolvedValue(order),
        deriveAccount: vi
            .fn()
            .mockReturnValue({ address: order.signerAddress } as never),
        ensureGas: vi.fn().mockResolvedValue(undefined),
        ensureMpen: vi.fn().mockResolvedValue(undefined),
        readAllowance: vi.fn().mockResolvedValue(0n),
        approve: vi.fn().mockResolvedValue(undefined),
        execute: vi.fn().mockResolvedValue("0xdead"),
        waitForReceipt: vi.fn().mockResolvedValue({ status: "success" }),
        now: () => new Date("2026-08-09T00:00:00Z"),
        ...overrides,
    };
}

describe("runPlanRunnerOnce", () => {
    it("funds, approves, executes and submits", async () => {
        const d = deps();
        await runPlanRunnerOnce(d);
        expect(d.ensureGas).toHaveBeenCalled();
        expect(d.ensureMpen).toHaveBeenCalledWith(
            expect.objectContaining({ price: 49_000_000n }),
        );
        expect(d.approve).toHaveBeenCalledWith(
            expect.anything(),
            49_000_000n,
        );
        expect(d.execute).toHaveBeenCalledWith(expect.anything(), "plan", 1);
        expect(d.markOrderSubmitted).toHaveBeenCalledWith(
            "o1",
            "0xdead",
            expect.any(Date),
        );
    });

    it("skips approve when the allowance already covers the price", async () => {
        const d = deps({ readAllowance: vi.fn().mockResolvedValue(60_000_000n) });
        await runPlanRunnerOnce(d);
        expect(d.approve).not.toHaveBeenCalled();
        expect(d.execute).toHaveBeenCalled();
    });

    it("buys a pack when the order kind is pack", async () => {
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([{ ...order, kind: "pack", price: 40_000_000n }]),
        });
        await runPlanRunnerOnce(d);
        expect(d.execute).toHaveBeenCalledWith(expect.anything(), "pack", 1);
    });

    it("fails permanently on an authorization revert", async () => {
        const d = deps({
            execute: vi.fn().mockRejectedValue(new Error("NotAuthorizedForCafe(1, 0x0)")),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("NotAuthorizedForCafe"),
            "not_authorized",
        );
        expect(d.markOrderRetry).not.toHaveBeenCalled();
    });

    it("retries a transient failure with backoff", async () => {
        const d = deps({ execute: vi.fn().mockRejectedValue(new Error("fetch failed")) });
        await runPlanRunnerOnce(d);
        expect(d.markOrderRetry).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("fetch failed"),
            1,
            expect.any(Date),
        );
    });

    it("gives up after the attempt cap", async () => {
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([{ ...order, attempts: 4 }]),
            execute: vi.fn().mockRejectedValue(new Error("fetch failed")),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("fetch failed"),
            "max_attempts",
        );
    });

    it("fails permanently when funding is unavailable", async () => {
        const d = deps({
            ensureMpen: vi.fn().mockRejectedValue(new Error("funding_unavailable")),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("funding_unavailable"),
            "funding_unavailable",
        );
    });

    it("confirms a submitted order whose receipt succeeded", async () => {
        const submitted = { ...order, status: "submitted" as const, txHash: "0xdead" };
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([]),
            claimSubmittedOrders: vi.fn().mockResolvedValue([submitted]),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderConfirmed).toHaveBeenCalledWith("o1");
    });

    it("fails a submitted order whose receipt reverted", async () => {
        const submitted = { ...order, status: "submitted" as const, txHash: "0xdead" };
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([]),
            claimSubmittedOrders: vi.fn().mockResolvedValue([submitted]),
            waitForReceipt: vi.fn().mockResolvedValue({ status: "reverted" }),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderFailed).toHaveBeenCalledWith(
            "o1",
            expect.stringContaining("reverted"),
            "reverted",
        );
    });

    it("returns a submitted order to pending when the receipt is not there yet", async () => {
        const submitted = { ...order, status: "submitted" as const, txHash: "0xdead" };
        const d = deps({
            findOrdersToRun: vi.fn().mockResolvedValue([]),
            claimSubmittedOrders: vi.fn().mockResolvedValue([submitted]),
            waitForReceipt: vi.fn().mockRejectedValue(new Error("receipt not found")),
        });
        await runPlanRunnerOnce(d);
        expect(d.markOrderPending).toHaveBeenCalledWith("o1", expect.any(Date));
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run src/core/plan/server/runner/__tests__/plan-runner.test.ts`
Expected: FAIL, "Failed to resolve import ../plan-runner".

- [ ] **Step 3: Escribir `plan-runner.ts`**

```ts
import "server-only";

import type { Address, Hex } from "viem";
import type { HDAccount } from "viem/accounts";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import {
    createChainPublicClient,
    createChainWalletClient,
} from "@/core/chain/chain";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import { backoffMs, classifyPlanError, MAX_PLAN_ATTEMPTS } from "@/core/plan/domain/errors";
import type { PlanOrderKind } from "@/core/plan/domain/types";
import type { PlanOrderRow } from "@/server/drizzle/schemas/plan-schema";
import {
    claimSubmittedOrders,
    findOrdersToRun,
    markOrderConfirmed,
    markOrderFailed,
    markOrderPending,
    markOrderRetry,
    markOrderSubmitted,
} from "../repository/plan-repository";
import { ensureGas, ensureMpen } from "./funding";

export const PLAN_BATCH_SIZE = 5;
const RECEIPT_WAIT_MS = 15_000;

export type PlanRunnerDeps = {
    findOrdersToRun: typeof findOrdersToRun;
    claimSubmittedOrders: typeof claimSubmittedOrders;
    markOrderSubmitted: typeof markOrderSubmitted;
    markOrderConfirmed: typeof markOrderConfirmed;
    markOrderRetry: typeof markOrderRetry;
    markOrderFailed: typeof markOrderFailed;
    markOrderPending: typeof markOrderPending;
    deriveAccount: (walletIndex: number) => HDAccount;
    ensureGas: (signer: Address) => Promise<void>;
    ensureMpen: (input: { account: HDAccount; price: bigint }) => Promise<void>;
    readAllowance: (owner: Address) => Promise<bigint>;
    approve: (account: HDAccount, amount: bigint) => Promise<void>;
    execute: (
        account: HDAccount,
        kind: PlanOrderKind,
        chainCafeId: number,
    ) => Promise<Hex>;
    waitForReceipt: (hash: Hex) => Promise<{ status: string }>;
    now: () => Date;
};

const defaults: PlanRunnerDeps = {
    findOrdersToRun,
    claimSubmittedOrders,
    markOrderSubmitted,
    markOrderConfirmed,
    markOrderRetry,
    markOrderFailed,
    markOrderPending,
    deriveAccount: deriveUserAccount,
    ensureGas: (signer) => ensureGas(signer),
    ensureMpen: (input) => ensureMpen(input),
    readAllowance: async (owner) =>
        createChainPublicClient().readContract({
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "allowance",
            args: [owner, getAddresses().planManager],
        }) as Promise<bigint>,
    approve: async (account, amount) => {
        const wallet = createChainWalletClient(undefined, account);
        const hash = await wallet.writeContract({
            account,
            chain: null,
            address: getAddresses().mockPEN,
            abi: abis.mockPEN,
            functionName: "approve",
            args: [getAddresses().planManager, amount],
        });
        await createChainPublicClient().waitForTransactionReceipt({ hash });
    },
    execute: async (account, kind, chainCafeId) => {
        const pub = createChainPublicClient();
        const address = getAddresses().planManager;
        const functionName = kind === "plan" ? "subscribe" : "buyPack";
        // Simulating first turns almost every revert into a clean failure
        // before any gas is spent.
        await pub.simulateContract({
            address,
            abi: abis.planManager,
            functionName,
            args: [BigInt(chainCafeId)],
            account: account.address,
        });
        const wallet = createChainWalletClient(undefined, account);
        return wallet.writeContract({
            account,
            chain: null,
            address,
            abi: abis.planManager,
            functionName,
            args: [BigInt(chainCafeId)],
        });
    },
    waitForReceipt: async (hash) =>
        createChainPublicClient().waitForTransactionReceipt({
            hash,
            timeout: RECEIPT_WAIT_MS,
        }),
    now: () => new Date(),
};

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function handleFailure(
    d: PlanRunnerDeps,
    order: PlanOrderRow,
    error: unknown,
): Promise<void> {
    const text = errorText(error);
    const { permanent, reason } = classifyPlanError(error);
    if (permanent && reason) {
        await d.markOrderFailed(order.id, text, reason);
        return;
    }
    const attempts = order.attempts + 1;
    if (attempts >= MAX_PLAN_ATTEMPTS) {
        await d.markOrderFailed(order.id, text, "max_attempts");
        return;
    }
    const nextRetryAt = new Date(d.now().getTime() + backoffMs(order.attempts));
    await d.markOrderRetry(order.id, text, attempts, nextRetryAt);
}

async function runPending(d: PlanRunnerDeps, order: PlanOrderRow): Promise<void> {
    try {
        const account = d.deriveAccount(order.signerWalletIndex);
        await d.ensureGas(account.address);
        await d.ensureMpen({ account, price: order.price });
        const allowance = await d.readAllowance(account.address);
        if (allowance < order.price) await d.approve(account, order.price);
        const hash = await d.execute(account, order.kind, order.chainCafeId);
        const nextRetryAt = new Date(d.now().getTime() + 2_000);
        await d.markOrderSubmitted(order.id, hash, nextRetryAt);
    } catch (error) {
        await handleFailure(d, order, error);
    }
}

async function runSubmitted(
    d: PlanRunnerDeps,
    order: PlanOrderRow,
): Promise<void> {
    if (!order.txHash) {
        await d.markOrderPending(order.id, d.now());
        return;
    }
    try {
        const receipt = await d.waitForReceipt(order.txHash as Hex);
        if (receipt.status === "success") {
            await d.markOrderConfirmed(order.id);
            return;
        }
        await d.markOrderFailed(order.id, "transaction reverted", "reverted");
    } catch {
        // No receipt yet: hand it back to the next tick instead of guessing.
        await d.markOrderPending(order.id, d.now());
    }
}

export async function runPlanRunnerOnce(
    overrides: Partial<PlanRunnerDeps> = {},
): Promise<void> {
    const d = { ...defaults, ...overrides };
    const pending = await d.findOrdersToRun(PLAN_BATCH_SIZE);
    for (const order of pending) await runPending(d, order);
    const submitted = await d.claimSubmittedOrders(PLAN_BATCH_SIZE);
    for (const order of submitted) await runSubmitted(d, order);
}

export async function recoverStuckPlanOrders(
    overrides: Partial<PlanRunnerDeps> = {},
): Promise<void> {
    const d = { ...defaults, ...overrides };
    const stuck = await d.claimSubmittedOrders(PLAN_BATCH_SIZE);
    for (const order of stuck) await runSubmitted(d, order);
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm vitest run src/core/plan/server/runner/__tests__/plan-runner.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/core/plan
git add src/core/plan
git commit -m "feat(plan): execute plan payments from the runner"
```

---

### Task 7: API

**Files:**
- Create: `src/core/plan/server/api/routes/create-plan-order.route.ts`
- Create: `src/core/plan/server/api/routes/get-plan-order.route.ts`
- Create: `src/core/plan/server/api/routes/list-plan-orders.route.ts`
- Create: `src/core/plan/server/api/routes/get-plan-status.route.ts`
- Create: `src/core/plan/server/api/router.ts`
- Modify: `src/server/router.ts`
- Test: `src/core/plan/server/api/__tests__/router.test.ts`

**Interfaces:**
- Consumes: servicios de Tasks 3 y 4; `planOrderSchema`, `planStatusSchema`, `createPlanOrderSchema` de Task 1.
- Produces: `planRouter` con prefijo `/plans`.

Rutas resultantes: `POST /api/v1/plans/orders`, `GET /api/v1/plans/orders/:id`, `GET /api/v1/plans/cafes/:cafeId/orders`, `GET /api/v1/plans/cafes/:cafeId/status`.

- [ ] **Step 1: Escribir el test que falla**

Antes de escribirlo, leer `src/core/purchase/server/api/__tests__/router.test.ts` y copiar su forma de montar la app y de simular sesión. Crear `src/core/plan/server/api/__tests__/router.test.ts` con esa forma y estos casos:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/plan/server/services/create-plan-order-service", () => ({
    createPlanOrderService: vi.fn(),
}));
vi.mock("@/core/plan/server/services/get-plan-status-service", () => ({
    getPlanStatusService: vi.fn(),
    findCafeMembership: vi.fn(),
}));

import { createPlanOrderService } from "@/core/plan/server/services/create-plan-order-service";
import { getPlanStatusService } from "@/core/plan/server/services/get-plan-status-service";
import { planRouter } from "../router";

const order = {
    id: "o1",
    cafeId: "c1",
    kind: "plan",
    priceSoles: 49,
    status: "pending",
    failureReason: null,
    txHash: null,
    createdAt: "2026-08-09T00:00:00.000Z",
};

describe("plan router", () => {
    it("creates an order and answers 201", async () => {
        vi.mocked(createPlanOrderService).mockResolvedValue({ ok: true, data: order } as never);
        const response = await planRouter.handle(
            new Request("http://localhost/plans/orders", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ cafeId: "c1", kind: "plan" }),
            }),
        );
        expect(response.status).toBe(201);
    });

    it("propagates a conflict when a payment is in flight", async () => {
        vi.mocked(createPlanOrderService).mockResolvedValue({
            ok: false,
            error: { type: "ConflictError", code: "CONFLICT", status: 409 },
        } as never);
        const response = await planRouter.handle(
            new Request("http://localhost/plans/orders", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ cafeId: "c1", kind: "plan" }),
            }),
        );
        expect(response.status).toBe(409);
    });

    it("rejects an unknown kind before reaching the service", async () => {
        const response = await planRouter.handle(
            new Request("http://localhost/plans/orders", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ cafeId: "c1", kind: "gift" }),
            }),
        );
        expect(response.status).toBe(422);
    });

    it("returns the cafe plan status", async () => {
        vi.mocked(getPlanStatusService).mockResolvedValue({
            ok: true,
            data: {
                cafeId: "c1",
                planActive: true,
                credits: 100,
                unallocatedReserveSoles: 30,
                canPay: true,
                inFlightOrderId: null,
            },
        } as never);
        const response = await planRouter.handle(
            new Request("http://localhost/plans/cafes/c1/status"),
        );
        expect(response.status).toBe(200);
    });
});
```

Ajustar el status esperado del cuerpo inválido al que devuelva Elysia en este proyecto: correr el test una vez y usar el valor observado, documentándolo en el propio test.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run src/core/plan/server/api/__tests__/router.test.ts`
Expected: FAIL, "Failed to resolve import ../router".

- [ ] **Step 3: Escribir `create-plan-order.route.ts`**

```ts
import { Elysia } from "elysia";
import {
    createPlanOrderSchema,
    planOrderSchema,
} from "@/core/plan/domain/schemas";
import { createPlanOrderService } from "@/core/plan/server/services/create-plan-order-service";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    createdResponseSchema,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";

export const createPlanOrderRoute = new Elysia().use(authed).post(
    "/orders",
    async ({ user, body, status }) => {
        const result = await createPlanOrderService(user.id, body);
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        body: createPlanOrderSchema,
        response: {
            201: createdResponseSchema(planOrderSchema, "PlanOrder"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Plans"], summary: "Create a plan or pack order" },
    },
);
```

- [ ] **Step 4: Escribir las tres rutas de lectura**

`get-plan-order.route.ts`:

```ts
import { Elysia } from "elysia";
import { planOrderSchema } from "@/core/plan/domain/schemas";
import { getPlanOrderService } from "@/core/plan/server/services/get-plan-order-service";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    okResponseSchema,
} from "@/server/common/responses";

export const getPlanOrderRoute = new Elysia().use(authed).get(
    "/orders/:id",
    async ({ user, params, status }) => {
        const result = await getPlanOrderService(user.id, params.id);
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return CommonResponse.ok({ response: result.data });
    },
    {
        authed: true,
        response: {
            200: okResponseSchema(planOrderSchema, "PlanOrder"),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Plans"], summary: "Get a plan order" },
    },
);
```

`list-plan-orders.route.ts`:

```ts
import { Elysia } from "elysia";
import { z } from "zod";
import { planOrderSchema } from "@/core/plan/domain/schemas";
import { listPlanOrdersService } from "@/core/plan/server/services/list-plan-orders-service";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    okResponseSchema,
} from "@/server/common/responses";

export const listPlanOrdersRoute = new Elysia().use(authed).get(
    "/cafes/:cafeId/orders",
    async ({ user, params, status }) => {
        const result = await listPlanOrdersService(user.id, params.cafeId);
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return CommonResponse.ok({ response: result.data });
    },
    {
        authed: true,
        response: {
            200: okResponseSchema(z.array(planOrderSchema), "PlanOrderList"),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Plans"], summary: "List a cafe's plan payments" },
    },
);
```

`get-plan-status.route.ts`:

```ts
import { Elysia } from "elysia";
import { planStatusSchema } from "@/core/plan/domain/schemas";
import { getPlanStatusService } from "@/core/plan/server/services/get-plan-status-service";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    okResponseSchema,
} from "@/server/common/responses";

export const getPlanStatusRoute = new Elysia().use(authed).get(
    "/cafes/:cafeId/status",
    async ({ user, params, status }) => {
        const result = await getPlanStatusService(user.id, params.cafeId);
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return CommonResponse.ok({ response: result.data });
    },
    {
        authed: true,
        response: {
            200: okResponseSchema(planStatusSchema, "PlanStatus"),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Plans"], summary: "Get a cafe's plan status" },
    },
);
```

Si `okResponseSchema` o `createdResponseSchema` tienen otra firma en este proyecto, confirmarla leyendo `src/core/purchase/server/api/routes/get-purchase.route.ts` y `list-cafe-purchases.route.ts`, y usar la misma.

- [ ] **Step 5: Escribir el router**

```ts
import { Elysia } from "elysia";
import { createPlanOrderRoute } from "./routes/create-plan-order.route";
import { getPlanOrderRoute } from "./routes/get-plan-order.route";
import { getPlanStatusRoute } from "./routes/get-plan-status.route";
import { listPlanOrdersRoute } from "./routes/list-plan-orders.route";

export const planRouter = new Elysia({ prefix: "/plans" })
    .use(createPlanOrderRoute)
    .use(listPlanOrdersRoute)
    .use(getPlanStatusRoute)
    .use(getPlanOrderRoute);
```

- [ ] **Step 6: Registrar el router**

En `src/server/router.ts`, añadir el import junto a los demás:

```ts
import { planRouter } from "@/core/plan/server/api/router";
```

y encadenar `.use(planRouter)` donde se encadenan `cafeRouter`, `purchaseRouter` y los demás.

- [ ] **Step 7: Correr el test para verificar que pasa**

Run: `pnpm vitest run src/core/plan/server/api/__tests__/router.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Correr la suite completa**

Run: `pnpm test`
Expected: PASS, sin regresiones frente al baseline de 516 tests.

- [ ] **Step 9: Commit**

```bash
pnpm biome check --write src/core/plan src/server/router.ts
git add src/core/plan src/server/router.ts
git commit -m "feat(plan): expose plan payment endpoints"
```

---

### Task 8: Tick en el worker

**Files:**
- Modify: `scripts/worker.ts`
- Test: `src/core/worker/__tests__/worker.test.ts`

**Interfaces:**
- Consumes: `runPlanRunnerOnce`, `recoverStuckPlanOrders` de Task 6.
- Produces: la llave `planRunner` en `intervals` y en `WorkerDependencies`.

- [ ] **Step 1: Añadir el caso al test del worker**

Leer `src/core/worker/__tests__/worker.test.ts` y añadir, siguiendo la forma de los casos existentes, uno que verifique que el tick del plan corre:

```ts
it("runs the plan runner on its interval", async () => {
    const runPlanRunnerOnce = vi.fn().mockResolvedValue(undefined);
    const controller = await startWorker({
        ...baseOverrides,
        runPlanRunnerOnce,
    });
    await advanceTicks(2_000);
    expect(runPlanRunnerOnce).toHaveBeenCalled();
    await controller.shutdown();
});

it("recovers stuck plan orders at startup", async () => {
    const recoverStuckPlanOrders = vi.fn().mockResolvedValue(undefined);
    const controller = await startWorker({
        ...baseOverrides,
        recoverStuckPlanOrders,
    });
    expect(recoverStuckPlanOrders).toHaveBeenCalled();
    await controller.shutdown();
});
```

Usar los nombres reales de las utilidades del archivo (`baseOverrides`, avance de timers) tal como estén definidos ahí.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run src/core/worker/__tests__/worker.test.ts`
Expected: FAIL, `runPlanRunnerOnce` nunca se llama.

- [ ] **Step 3: Registrar el tick**

En `scripts/worker.ts`:

1. Añadir el import:

```ts
import {
    recoverStuckPlanOrders,
    runPlanRunnerOnce,
} from "@/core/plan/server/runner/plan-runner";
```

2. Añadir el intervalo:

```ts
const intervals = {
    relayer: 2_000,
    planRunner: 2_000,
    indexer: 2_000,
    expiry: 30_000,
    reconciler: 60_000,
} as const;
```

3. Añadir a `WorkerDependencies`:

```ts
    runPlanRunnerOnce: () => Promise<unknown>;
    recoverStuckPlanOrders: () => Promise<unknown>;
```

4. Añadir a los valores por defecto:

```ts
        runPlanRunnerOnce: () => runPlanRunnerOnce(),
        recoverStuckPlanOrders: () => recoverStuckPlanOrders(),
```

5. En el bloque de arranque, después de `await dependencies.recoverStuckJobs()`, recuperar también las órdenes de plan dentro de su propio try/catch:

```ts
        try {
            await dependencies.recoverStuckPlanOrders();
        } catch (error) {
            logFailure("recovery", error);
        }
```

6. Arrancar el loop junto a los demás:

```ts
        startLoop("planRunner", dependencies.runPlanRunnerOnce);
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm vitest run src/core/worker/__tests__/worker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write scripts/worker.ts src/core/worker
git add scripts/worker.ts src/core/worker
git commit -m "feat(plan): run plan orders from the worker"
```

---

### Task 9: Página del plan

**Files:**
- Create: `src/core/plan/client/hooks.ts`
- Create: `src/core/plan/client/ui/plan-card.tsx`
- Create: `src/core/plan/client/ui/plan-history.tsx`
- Create: `src/app/(app)/(workspace)/cafe/[cafeId]/plan/page.tsx`
- Test: `src/app/(app)/(workspace)/cafe/[cafeId]/plan/__tests__/plan-page.test.tsx`

**Interfaces:**
- Consumes: endpoints de Task 7; `PLAN_SPLITS`, `mpenToSoles` de Task 1.
- Produces:
  - `usePlanStatus(cafeId: string)`, `usePlanOrders(cafeId: string)`, `usePlanOrder(orderId: string | null)`, `useCreatePlanOrder(cafeId: string)`
  - `PlanCard`, `PlanHistory`

- [ ] **Step 1: Escribir el test que falla**

Leer `src/app/(app)/(workspace)/cafe/[cafeId]/terminal/__tests__/terminal-page.test.tsx` y reutilizar su forma de mockear hooks y renderizar. Crear el test de la página con estos casos:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const usePlanStatus = vi.fn();
const usePlanOrders = vi.fn();
const useCreatePlanOrder = vi.fn();

vi.mock("next/navigation", () => ({ useParams: () => ({ cafeId: "c1" }) }));
vi.mock("@/core/plan/client/hooks", () => ({
    usePlanStatus: (...args: unknown[]) => usePlanStatus(...args),
    usePlanOrders: (...args: unknown[]) => usePlanOrders(...args),
    usePlanOrder: () => ({ data: undefined }),
    useCreatePlanOrder: (...args: unknown[]) => useCreatePlanOrder(...args),
}));

import PlanPage from "../page";

function setup(status: Record<string, unknown>, orders: unknown[] = []) {
    usePlanStatus.mockReturnValue({ data: status, isLoading: false });
    usePlanOrders.mockReturnValue({ data: orders, isLoading: false });
    useCreatePlanOrder.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

describe("plan page", () => {
    it("offers to activate the plan when it is inactive", () => {
        setup({
            cafeId: "c1",
            planActive: false,
            credits: 0,
            unallocatedReserveSoles: 0,
            canPay: true,
            inFlightOrderId: null,
        });
        render(<PlanPage />);
        expect(screen.getByRole("button", { name: /Activar plan/i })).toBeEnabled();
        expect(screen.getByText(/S\/49/)).toBeInTheDocument();
    });

    it("offers a pack once the plan is active and shows credits and reserve", () => {
        setup({
            cafeId: "c1",
            planActive: true,
            credits: 87,
            unallocatedReserveSoles: 26.1,
            canPay: true,
            inFlightOrderId: null,
        });
        render(<PlanPage />);
        expect(screen.getByRole("button", { name: /Comprar pack/i })).toBeEnabled();
        expect(screen.getByText("87")).toBeInTheDocument();
        expect(screen.getByText(/26\.10/)).toBeInTheDocument();
    });

    it("explains that credits do not expire", () => {
        setup({
            cafeId: "c1",
            planActive: true,
            credits: 10,
            unallocatedReserveSoles: 3,
            canPay: true,
            inFlightOrderId: null,
        });
        render(<PlanPage />);
        expect(screen.getByText(/no vencen/i)).toBeInTheDocument();
    });

    it("blocks the button while a payment is in flight", () => {
        setup({
            cafeId: "c1",
            planActive: false,
            credits: 0,
            unallocatedReserveSoles: 0,
            canPay: true,
            inFlightOrderId: "o1",
        });
        render(<PlanPage />);
        expect(screen.getByRole("button", { name: /Activar plan/i })).toBeDisabled();
    });

    it("hides the button and explains when the wallet is not authorized", () => {
        setup({
            cafeId: "c1",
            planActive: false,
            credits: 0,
            unallocatedReserveSoles: 0,
            canPay: false,
            inFlightOrderId: null,
        });
        render(<PlanPage />);
        expect(screen.queryByRole("button", { name: /Activar plan/i })).toBeNull();
        expect(screen.getByText(/no está autorizada/i)).toBeInTheDocument();
    });

    it("lists past payments", () => {
        setup(
            {
                cafeId: "c1",
                planActive: true,
                credits: 100,
                unallocatedReserveSoles: 30,
                canPay: true,
                inFlightOrderId: null,
            },
            [
                {
                    id: "o1",
                    cafeId: "c1",
                    kind: "plan",
                    priceSoles: 49,
                    status: "confirmed",
                    failureReason: null,
                    txHash: "0xdead",
                    createdAt: "2026-08-09T00:00:00.000Z",
                },
            ],
        );
        render(<PlanPage />);
        expect(screen.getByText(/Plan/)).toBeInTheDocument();
        expect(screen.getByText(/0xdead/)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run "src/app/(app)/(workspace)/cafe/[cafeId]/plan/__tests__/plan-page.test.tsx"`
Expected: FAIL, no existe `../page`.

- [ ] **Step 3: Escribir los hooks**

Crear `src/core/plan/client/hooks.ts` siguiendo exactamente el estilo de `src/core/cafe/client/hooks.ts` (`useElysia`, `unwrapResponse`, `withErrorToast`):

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useElysia } from "@/frontend/lib/eden";

const unwrapResponse = (result: unknown) =>
    (result as { response: unknown }).response;

const showError = (error: unknown) => {
    toast.error(
        error instanceof Error ? error.message : "Ocurrió un error inesperado",
    );
};

const withErrorToast = <T extends object>(options: T) =>
    ({ ...options, onError: showError }) as T;

export const usePlanStatus = (cafeId: string) => {
    const client = useElysia().plans;
    return useQuery({
        ...(client.cafes({ cafeId }).status.get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["plans", cafeId, "status"],
        select: unwrapResponse,
        // The indexer credits the cafe a tick after the receipt lands.
        refetchInterval: 3_000,
    });
};

export const usePlanOrders = (cafeId: string) => {
    const client = useElysia().plans;
    return useQuery({
        ...(client.cafes({ cafeId }).orders.get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["plans", cafeId, "orders"],
        select: unwrapResponse,
    });
};

export const usePlanOrder = (orderId: string | null) => {
    const client = useElysia().plans;
    return useQuery({
        ...(client.orders({ id: orderId ?? "" }).get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["plans", "orders", orderId],
        select: unwrapResponse,
        enabled: orderId !== null,
        refetchInterval: 2_000,
    });
};

export const useCreatePlanOrder = (cafeId: string) => {
    const client = useElysia().plans;
    const queryClient = useQueryClient();
    return useMutation(
        withErrorToast({
            ...client.orders.post.mutationOptions(),
            onSuccess: () =>
                queryClient.invalidateQueries({ queryKey: ["plans", cafeId] }),
        }),
    );
};
```

Si la forma de Eden para rutas anidadas difiere, ajustarla mirando cómo `src/core/purchase/client` construye llamadas con parámetros de ruta, y mantener las mismas `queryKey`.

- [ ] **Step 4: Escribir `plan-card.tsx`**

```tsx
"use client";

import { PLAN_SPLITS } from "@/core/plan/domain/schemas";
import type { PlanOrderKind, PlanStatusView } from "@/core/plan/domain/types";
import { Button } from "@/frontend/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";

const soles = (value: number) =>
    value.toLocaleString("es-PE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

function SplitRow({ label, amount }: { label: string; amount: bigint }) {
    return (
        <div className="flex justify-between text-sm">
            <span>{label}</span>
            <span>S/{soles(Number(amount) / 1_000_000)}</span>
        </div>
    );
}

export function PlanCard({
    status,
    onPay,
    isPending,
}: {
    status: PlanStatusView;
    onPay: (kind: PlanOrderKind) => void;
    isPending: boolean;
}) {
    const kind: PlanOrderKind = status.planActive ? "pack" : "plan";
    const split = PLAN_SPLITS[kind];
    const price = kind === "plan" ? 49 : 40;
    const label = kind === "plan" ? "Activar plan" : "Comprar pack";
    const blocked = status.inFlightOrderId !== null || isPending;

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    {status.planActive ? "Plan activo" : "Plan inactivo"}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-8">
                    <div>
                        <p className="text-sm text-muted-foreground">
                            Créditos disponibles
                        </p>
                        <p className="text-3xl font-semibold">{status.credits}</p>
                    </div>
                    <div>
                        <p className="text-sm text-muted-foreground">
                            Reserva no asignada
                        </p>
                        <p className="text-3xl font-semibold">
                            S/{soles(status.unallocatedReserveSoles)}
                        </p>
                    </div>
                </div>

                <p className="text-sm text-muted-foreground">
                    Tus créditos no vencen. Los que no emitas siguen disponibles, y
                    con ellos su reserva de S/0.30 por crédito.
                </p>

                <div className="space-y-1 rounded-md border p-3">
                    <p className="text-sm font-medium">
                        {label} · S/{price}
                    </p>
                    <SplitRow label="Reserva de rewards" amount={split.reserve} />
                    <SplitRow label="Fondo común" amount={split.fund} />
                    <SplitRow label="Tesorería PUNCH" amount={split.treasury} />
                    <p className="text-sm text-muted-foreground">+100 créditos</p>
                </div>

                {status.canPay ? (
                    <Button
                        disabled={blocked}
                        onClick={() => onPay(kind)}
                    >
                        {status.inFlightOrderId
                            ? "Procesando pago…"
                            : `${label} · S/${price}`}
                    </Button>
                ) : (
                    <p className="text-sm text-destructive">
                        Tu cuenta no está autorizada en la cadena para pagar por este
                        café. Pídele al dueño que te autorice como operador.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 5: Escribir `plan-history.tsx`**

```tsx
"use client";

import type { PlanOrderView } from "@/core/plan/domain/types";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/frontend/components/ui/card";

const statusLabel: Record<PlanOrderView["status"], string> = {
    pending: "En proceso",
    submitted: "Enviado",
    confirmed: "Confirmado",
    failed: "Falló",
};

export function PlanHistory({ orders }: { orders: PlanOrderView[] }) {
    if (orders.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Historial de pagos</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        Todavía no hay pagos registrados.
                    </p>
                </CardContent>
            </Card>
        );
    }
    return (
        <Card>
            <CardHeader>
                <CardTitle>Historial de pagos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {orders.map((order) => (
                    <div
                        key={order.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0"
                    >
                        <span>{order.kind === "plan" ? "Plan" : "Pack"}</span>
                        <span>S/{order.priceSoles.toFixed(2)}</span>
                        <span>
                            {new Date(order.createdAt).toLocaleDateString("es-PE")}
                        </span>
                        <span>{statusLabel[order.status]}</span>
                        <span className="font-mono text-xs">
                            {order.txHash ?? order.failureReason ?? ""}
                        </span>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 6: Escribir la página**

```tsx
"use client";

import { useParams } from "next/navigation";
import {
    useCreatePlanOrder,
    usePlanOrders,
    usePlanStatus,
} from "@/core/plan/client/hooks";
import { PlanCard } from "@/core/plan/client/ui/plan-card";
import { PlanHistory } from "@/core/plan/client/ui/plan-history";
import type {
    PlanOrderKind,
    PlanOrderView,
    PlanStatusView,
} from "@/core/plan/domain/types";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function PlanPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const statusQuery = usePlanStatus(cafeId);
    const ordersQuery = usePlanOrders(cafeId);
    const createOrder = useCreatePlanOrder(cafeId);

    const status = statusQuery.data as PlanStatusView | undefined;
    const orders = (ordersQuery.data ?? []) as PlanOrderView[];

    if (!status) return <Spinner />;

    const pay = (kind: PlanOrderKind) =>
        createOrder.mutate({ cafeId, kind } as never);

    return (
        <div className="space-y-6 p-4">
            <h1 className="text-2xl font-semibold">Plan del café</h1>
            <PlanCard
                status={status}
                onPay={pay}
                isPending={createOrder.isPending}
            />
            <PlanHistory orders={orders} />
        </div>
    );
}
```

- [ ] **Step 7: Correr el test para verificar que pasa**

Run: `pnpm vitest run "src/app/(app)/(workspace)/cafe/[cafeId]/plan/__tests__/plan-page.test.tsx"`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
pnpm biome check --write src/core/plan "src/app/(app)/(workspace)/cafe"
git add src/core/plan "src/app/(app)/(workspace)/cafe"
git commit -m "feat(plan): add the cafe plan page"
```

---

### Task 10: Indicador de créditos

**Files:**
- Create: `src/core/plan/client/ui/credits-badge.tsx`
- Modify: `src/app/(app)/(workspace)/cafe/[cafeId]/page.tsx`
- Modify: `src/app/(app)/(workspace)/cafe/[cafeId]/terminal/page.tsx`
- Test: `src/core/plan/client/ui/__tests__/credits-badge.test.tsx`

**Interfaces:**
- Consumes: `usePlanStatus` de Task 9; `LOW_CREDITS_THRESHOLD` de Task 1.
- Produces: `CreditsBadge({ cafeId }: { cafeId: string })`.

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const usePlanStatus = vi.fn();
vi.mock("@/core/plan/client/hooks", () => ({
    usePlanStatus: (...args: unknown[]) => usePlanStatus(...args),
}));

import { CreditsBadge } from "../credits-badge";

describe("CreditsBadge", () => {
    it("shows the credit count", () => {
        usePlanStatus.mockReturnValue({
            data: { credits: 42, planActive: true },
            isLoading: false,
        });
        render(<CreditsBadge cafeId="c1" />);
        expect(screen.getByText(/42/)).toBeInTheDocument();
    });

    it("warns when credits run low", () => {
        usePlanStatus.mockReturnValue({
            data: { credits: 4, planActive: true },
            isLoading: false,
        });
        render(<CreditsBadge cafeId="c1" />);
        expect(screen.getByText(/Te quedan pocos créditos/i)).toBeInTheDocument();
    });

    it("tells the cafe to activate the plan when it has none", () => {
        usePlanStatus.mockReturnValue({
            data: { credits: 0, planActive: false },
            isLoading: false,
        });
        render(<CreditsBadge cafeId="c1" />);
        expect(screen.getByText(/Activa tu plan/i)).toBeInTheDocument();
    });

    it("renders nothing while loading", () => {
        usePlanStatus.mockReturnValue({ data: undefined, isLoading: true });
        const { container } = render(<CreditsBadge cafeId="c1" />);
        expect(container).toBeEmptyDOMElement();
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run src/core/plan/client/ui/__tests__/credits-badge.test.tsx`
Expected: FAIL, no existe `../credits-badge`.

- [ ] **Step 3: Escribir el componente**

```tsx
"use client";

import Link from "next/link";
import { usePlanStatus } from "@/core/plan/client/hooks";
import { LOW_CREDITS_THRESHOLD } from "@/core/plan/domain/schemas";
import type { PlanStatusView } from "@/core/plan/domain/types";

export function CreditsBadge({ cafeId }: { cafeId: string }) {
    const { data } = usePlanStatus(cafeId);
    const status = data as PlanStatusView | undefined;
    if (!status) return null;

    if (!status.planActive) {
        return (
            <Link
                href={`/cafe/${cafeId}/plan`}
                className="text-sm text-destructive underline"
            >
                Activa tu plan para poder emitir PUNCH
            </Link>
        );
    }

    const low = status.credits <= LOW_CREDITS_THRESHOLD;
    return (
        <Link href={`/cafe/${cafeId}/plan`} className="text-sm">
            <span className="font-semibold">{status.credits}</span> créditos
            {low ? (
                <span className="ml-2 text-destructive">
                    Te quedan pocos créditos, compra un pack
                </span>
            ) : null}
        </Link>
    );
}
```

- [ ] **Step 4: Insertar el indicador en el dashboard y el terminal**

En `src/app/(app)/(workspace)/cafe/[cafeId]/page.tsx`, añadir el import y renderizar el indicador junto al `StatusBadge` de la cabecera, con un enlace a la página del plan:

```tsx
import { CreditsBadge } from "@/core/plan/client/ui/credits-badge";
```

```tsx
<div className="flex items-center gap-3">
    <StatusBadge status={cafe.onboardingStatus} />
    <CreditsBadge cafeId={cafeId} />
    <Link href={`/cafe/${cafeId}/plan`} className="text-sm underline">
        Plan y créditos
    </Link>
</div>
```

En `src/app/(app)/(workspace)/cafe/[cafeId]/terminal/page.tsx`, añadir el mismo import y renderizar el indicador en la cabecera, antes del formulario de cobro:

```tsx
<CreditsBadge cafeId={cafeId} />
```

Insertar cada bloque en el contenedor de cabecera que ya exista en esos archivos, sin reordenar el resto del contenido.

- [ ] **Step 5: Correr los tests afectados**

Run: `pnpm vitest run src/core/plan "src/app/(app)/(workspace)/cafe"`
Expected: PASS, incluidos los tests preexistentes del dashboard y del terminal.

- [ ] **Step 6: Commit**

```bash
pnpm biome check --write src/core/plan "src/app/(app)/(workspace)/cafe"
git add src/core/plan "src/app/(app)/(workspace)/cafe"
git commit -m "feat(plan): surface remaining credits in the cafe panel"
```

---

### Task 11: Recorrido sobre cadena viva

**Files:**
- Create: `src/core/plan/server/__tests__/plan-payment.live.test.ts`

**Interfaces:**
- Consumes: todo lo anterior, más `runIndexerOnce` de `@/core/chain/server/indexer/indexer`.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Escribir el test de cadena viva**

```ts
import { eq } from "drizzle-orm";
import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { describe, expect, it } from "vitest";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import { createPlanOrderService } from "@/core/plan/server/services/create-plan-order-service";
import { getPlanStatusService } from "@/core/plan/server/services/get-plan-status-service";
import { runPlanRunnerOnce } from "@/core/plan/server/runner/plan-runner";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCafeCredit } from "@/server/drizzle/schemas/chain-schema";
import { planOrder } from "@/server/drizzle/schemas/plan-schema";

const live =
    process.env.PUNCH_RUN_INTEGRATION === "1" &&
    process.env.PUNCH_RUN_LIVE_CHAIN === "1";
const describeLive = describe.skipIf(!live);

const pub = createPublicClient({
    chain: foundry,
    transport: http(process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545"),
});

async function readBalances() {
    const addresses = getAddresses();
    const read = (account: `0x${string}`) =>
        pub.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [account],
        }) as Promise<bigint>;
    return {
        vault: await read(addresses.punchVault),
        fund: await read(addresses.networkFund),
    };
}

async function drainRunner(times = 8) {
    for (let i = 0; i < times; i += 1) {
        await runPlanRunnerOnce();
        await runIndexerOnce();
    }
}

describeLive("plan payment on a live chain", () => {
    it("activates a plan, buys a pack and credits the cafe", async () => {
        // Pick a seeded cafe with no plan yet. bootstrap-local subscribes the
        // demo cafes, so this test needs one that it left untouched; if every
        // cafe has a plan, it buys packs only and asserts the pack numbers.
        const [owner] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, "esquinasur@punch.pe"));
        const [target] = await db
            .select({ id: cafe.id, chainCafeId: cafe.chainCafeId })
            .from(cafe)
            .where(eq(cafe.slug, "esquina-sur"));
        expect(owner).toBeDefined();
        expect(target?.chainCafeId).not.toBeNull();
        if (!owner || !target?.chainCafeId) return;

        const before = await readBalances();
        const beforeStatus = await getPlanStatusService(owner.id, target.id);
        expect(beforeStatus.ok).toBe(true);
        if (!beforeStatus.ok) return;
        const kind = beforeStatus.data.planActive ? "pack" : "plan";

        const created = await createPlanOrderService(owner.id, {
            cafeId: target.id,
            kind,
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        await drainRunner();

        const [row] = await db
            .select()
            .from(planOrder)
            .where(eq(planOrder.id, created.data.id));
        expect(row?.status).toBe("confirmed");
        expect(row?.txHash).toMatch(/^0x[0-9a-f]{64}$/);

        const [credit] = await db
            .select({ credits: projectionCafeCredit.credits })
            .from(projectionCafeCredit)
            .where(eq(projectionCafeCredit.chainCafeId, target.chainCafeId));
        expect(credit?.credits).toBe(
            BigInt(beforeStatus.data.credits) + 100n,
        );

        const after = await readBalances();
        expect(after.vault - before.vault).toBe(30_000_000n);
        expect(after.fund - before.fund).toBe(5_000_000n);

        const afterStatus = await getPlanStatusService(owner.id, target.id);
        expect(afterStatus.ok).toBe(true);
        if (!afterStatus.ok) return;
        expect(afterStatus.data.planActive).toBe(true);
        expect(afterStatus.data.unallocatedReserveSoles).toBeGreaterThan(
            beforeStatus.data.unallocatedReserveSoles,
        );
    });

    it("refuses a second payment while one is in flight", async () => {
        const [owner] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, "esquinasur@punch.pe"));
        const [target] = await db
            .select({ id: cafe.id })
            .from(cafe)
            .where(eq(cafe.slug, "esquina-sur"));
        if (!owner || !target) return;

        const first = await createPlanOrderService(owner.id, {
            cafeId: target.id,
            kind: "pack",
        });
        expect(first.ok).toBe(true);
        const second = await createPlanOrderService(owner.id, {
            cafeId: target.id,
            kind: "pack",
        });
        expect(second.ok).toBe(false);
        if (second.ok) return;
        expect(second.error.status).toBe(409);

        await drainRunner();
    });
});
```

- [ ] **Step 2: Levantar el entorno completo**

```bash
docker start punch-pg
# DB fresca
pnpm db:migrate
pnpm db:seed
# anvil fresco en otra terminal: anvil --chain-id 31337
pnpm chain:deploy
pnpm chain:bootstrap-local
```

- [ ] **Step 3: Correr el test de cadena viva**

Run: `PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1 pnpm vitest run src/core/plan/server/__tests__/plan-payment.live.test.ts`
Expected: PASS, 2 tests. Si falla porque todos los cafés sembrados ya tienen plan, el primer test compra un pack y las aserciones de tesorería cambian a S/5; ajustar el test para leer el split esperado de `PLAN_SPLITS[kind]` en vez de números fijos.

- [ ] **Step 4: Verificación manual del panel**

```bash
pnpm dev          # en una terminal
pnpm worker       # en otra
```

Entrar como el dueño de un café, abrir `/cafe/<id>/plan`, comprar un pack y confirmar: el botón se bloquea, el estado pasa a confirmado, el historial suma una fila con hash, y el contador de créditos sube en 100 en el dashboard y en el terminal.

- [ ] **Step 5: Correr la suite completa**

Run: `pnpm test`
Expected: PASS, sin regresiones.

- [ ] **Step 6: Commit**

```bash
pnpm biome check --write src/core/plan
git add src/core/plan
git commit -m "test(plan): cover plan payment against a live chain"
```

---

## Deuda registrada

`plan_order` duplica la lógica de claim, lease, reintento y backoff que vive en `relayer.ts`. Es deliberado: aísla esta rama de las sesiones paralelas de redención y campañas. Cuando las tres hayan mergeado, unificar en una cola genérica con `kind` y `subject_id` sin FK a `purchase_order`, y migrar `plan_order` a ella. Los nombres de estado (`pending`, `submitted`, `confirmed`, `failed`) y de columnas (`attempts`, `next_retry_at`, `tx_hash`, `last_error`) ya coinciden con `relayer_job` para que esa migración sea mecánica.
