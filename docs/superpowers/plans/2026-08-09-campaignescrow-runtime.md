# CampaignEscrow Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the deployed `CampaignEscrow` contract into the runtime so verified-acquisition campaigns are funded, published, unlocked and redeemed on chain, with Postgres reduced to a projection of escrow events.

**Architecture:** The relayer job rail is generalized from "one job per purchase order" to a kind-dispatched rail with per-kind signer keys and lifecycle hooks. Campaign lifecycle operations become jobs signed by a dedicated ops wallet; voucher unlock and redeem become jobs signed by the relayer acting as `campaignOperator`. All campaign state visible to the app is projected from escrow events by the indexer — no service writes it.

**Tech Stack:** TypeScript, Next.js, Elysia, Drizzle ORM, Postgres, viem, Foundry/anvil, Vitest.

Spec: `docs/superpowers/specs/2026-08-09-campaignescrow-runtime-design.md`

## Global Constraints

- Never commit `src/core/chain/addresses.local.json`. Never modify `.env`.
- Do not modify `src/core/chain/abis.ts` — the generated ABI already contains every `CampaignEscrow` function, event and error.
- Verification always uses a fresh database: create DB → `pnpm db:migrate` → `pnpm db:seed` → fresh anvil on chain 31337 → `pnpm chain:deploy` → `pnpm chain:bootstrap-local`. The database in `.env` has a broken migration lineage and must not be used to validate migrations.
- Postgres runs in docker container `punch-pg`. On `ETIMEDOUT`, run `docker start punch-pg`.
- Integration tests are gated by `PUNCH_RUN_INTEGRATION=1`; live-chain tests additionally by `PUNCH_RUN_LIVE_CHAIN=1`.
- The local mnemonic is TEST-ONLY for chain 31337. Never log or expose keys or mnemonics, and never send them to a client.
- Do not deploy to Arbitrum Sepolia.
- Run `pnpm check` and `pnpm typecheck` before every commit.
- Migrations are generated with `pnpm db:generate` — never hand-write files in `drizzle/`.

## File Structure

**New module `src/core/campaign/`**

| File | Responsibility |
|---|---|
| `domain/types.ts` | Campaign parameter and lifecycle types |
| `domain/schemas.ts` | Zod validation of campaign input |
| `domain/transitions.ts` | Which operation is legal in which lifecycle state |
| `server/repository/campaign-repository.ts` | Campaign intent rows, chain link, projection reads |
| `server/services/create-campaign-service.ts` | Validate + insert + enqueue `campaign_create` |
| `server/services/fund-campaign-service.ts` | Enqueue the approve→fund job chain |
| `server/services/publish-campaign-service.ts` | Enqueue `campaign_publish` |
| `server/services/get-campaign-funding-service.ts` | Funding state for the café screen |
| `server/api/routes/*.route.ts` | Café endpoints |

**Relayer generalization in `src/core/chain/server/relayer/`**

| File | Responsibility |
|---|---|
| `job-repository.ts` | Generic `relayer_job` state machine, no purchase knowledge |
| `handlers/types.ts` | `JobHandler`, `JobSigner`, `JobCall` contracts |
| `handlers/registry.ts` | Kind → handler lookup |
| `handlers/consumption-record.ts` | Today's `recordConsumption` behavior, ported |
| `handlers/campaign-create.ts` | `createCampaign` + receipt correlation |
| `handlers/campaign-fund.ts` | `approve` and `fundCampaign` |
| `handlers/campaign-publish.ts` | `publishCampaign` |
| `handlers/voucher-unlock.ts` | Preflight + `unlockVoucher` |
| `handlers/voucher-redeem.ts` | `redeemVoucher` |
| `signers.ts` | Resolve a `JobSigner` to a wallet client |
| `relayer.ts` | Generic drain only |

**Indexer**

| File | Responsibility |
|---|---|
| `indexer/campaign-projection.ts` | Apply the five escrow events |
| `indexer/apply-event.ts` | Dispatch escrow events to the projection |
| `indexer/indexer.ts` | Register the `campaignEscrow` source |

---

### Task 1: Ops wallet key

The ops wallet is the `owner` of `CampaignEscrow`. It must never collide with a user wallet: `wallet_index_seq` hands out user indexes starting at 0, so low indexes get consumed by registration.

**Files:**
- Modify: `src/config/env.ts:23` (add `OPS_WALLET_INDEX` to `server` and `runtimeEnv`)
- Create: `src/core/chain/server/wallet/ops-account.ts`
- Test: `src/core/chain/server/wallet/__tests__/ops-account.test.ts`

**Interfaces:**
- Consumes: `deriveAccount(mnemonic, addressIndex)` from `src/core/chain/server/wallet/derive.ts`
- Produces: `deriveOpsAccount(): HDAccount`, and `env.OPS_WALLET_INDEX: number`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/chain/server/wallet/__tests__/ops-account.test.ts
import { describe, expect, it, vi } from "vitest";

const MNEMONIC =
    "test test test test test test test test test test test junk";

vi.mock("@/config/env", () => ({
    env: {
        WALLET_MASTER_MNEMONIC: MNEMONIC,
        OPS_WALLET_INDEX: 9000,
        RELAYER_WALLET_INDEX: 0,
    },
}));

describe("deriveOpsAccount", () => {
    it("derives the reserved ops index, not the relayer index", async () => {
        const { deriveOpsAccount } = await import("../ops-account");
        const { deriveAccount } = await import("../derive");

        expect(deriveOpsAccount().address).toBe(
            deriveAccount(MNEMONIC, 9000).address,
        );
        expect(deriveOpsAccount().address).not.toBe(
            deriveAccount(MNEMONIC, 0).address,
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/chain/server/wallet/__tests__/ops-account.test.ts`
Expected: FAIL — cannot find module `../ops-account`

- [ ] **Step 3: Add the env variable**

In `src/config/env.ts`, inside `server`, directly after the `RELAYER_WALLET_INDEX` line:

```ts
        // Reserved high index: wallet_index_seq hands user wallets out from 0,
        // so a low ops index would eventually be derived by a real user.
        OPS_WALLET_INDEX: z.coerce
            .number()
            .int()
            .nonnegative()
            .default(9000),
```

Inside `runtimeEnv`, after the `RELAYER_WALLET_INDEX` line:

```ts
        OPS_WALLET_INDEX: process.env.OPS_WALLET_INDEX,
```

Then reject the collision explicitly — replace `export const env = createEnv({` with:

```ts
const parsedEnv = createEnv({
```

and append at the end of the file:

```ts
if (parsedEnv.OPS_WALLET_INDEX === parsedEnv.RELAYER_WALLET_INDEX) {
    throw new Error(
        "OPS_WALLET_INDEX must differ from RELAYER_WALLET_INDEX: the ops key owns CampaignEscrow and must not be the hot relayer key",
    );
}

export const env = parsedEnv;
```

- [ ] **Step 4: Write the ops account module**

```ts
// src/core/chain/server/wallet/ops-account.ts
import "server-only";
import type { HDAccount } from "viem/accounts";
import { env } from "@/config/env";
import { deriveAccount } from "./derive";

/**
 * Owner of CampaignEscrow. Separate from the relayer key, which signs on every
 * purchase and is the most exposed key in the system.
 */
export function deriveOpsAccount(): HDAccount {
    return deriveAccount(env.WALLET_MASTER_MNEMONIC, env.OPS_WALLET_INDEX);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/core/chain/server/wallet/__tests__/ops-account.test.ts`
Expected: PASS

- [ ] **Step 6: Verify nothing else broke**

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: all pass, same counts as baseline plus 1 new test

- [ ] **Step 7: Commit**

```bash
git add src/config/env.ts src/core/chain/server/wallet/ops-account.ts src/core/chain/server/wallet/__tests__/ops-account.test.ts
git commit -m "feat(chain): add reserved ops wallet index"
```

---

### Task 2: Deploy wiring for the escrow operator and owner

`setCampaignOperator` is `onlyOwner`, so it must be called while the deployer is still the owner. Ownership transfer comes second.

**Files:**
- Modify: `scripts/dev-chain.ts:159-162` (after the `setCampaignEscrow` write, before the return)
- Test: `src/core/chain/__tests__/dev-chain.test.ts`

**Interfaces:**
- Consumes: `deployAll` from `scripts/dev-chain.ts`, `abis.campaignEscrow`
- Produces: after `deployAll`, `campaignEscrow.campaignOperator()` is the relayer address and `campaignEscrow.owner()` is the ops address

- [ ] **Step 1: Read the existing test file to match its harness**

Run: `cat src/core/chain/__tests__/dev-chain.test.ts`

Note how it gates on `PUNCH_RUN_INTEGRATION` / anvil availability, and reuse that exact gating in the next step rather than inventing a new one.

- [ ] **Step 2: Write the failing test**

Append to `src/core/chain/__tests__/dev-chain.test.ts`, inside the existing live/integration `describe` block that already calls `deployAll`:

```ts
    it("points the escrow operator at the relayer and hands ownership to ops", async () => {
        const addresses = await deployAll({ rpcUrl });
        const pub = createPublicClient({
            chain: foundry,
            transport: http(rpcUrl),
        });

        const operator = await pub.readContract({
            address: addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "campaignOperator",
        });
        const owner = await pub.readContract({
            address: addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "owner",
        });

        expect(operator).toBe(relayerAddress(rpcUrl));
        expect(owner).toBe(opsAddress(rpcUrl));
        expect(operator).not.toBe(owner);
    });
```

Add these two helpers at the top of the same file, below the imports:

```ts
const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk";
const appMnemonic = process.env.WALLET_MASTER_MNEMONIC ?? ANVIL_MNEMONIC;

function relayerAddress() {
    return mnemonicToAccount(appMnemonic, {
        addressIndex: Number(process.env.RELAYER_WALLET_INDEX ?? 0),
    }).address;
}

function opsAddress() {
    return mnemonicToAccount(appMnemonic, {
        addressIndex: Number(process.env.OPS_WALLET_INDEX ?? 9000),
    }).address;
}
```

and drop the `rpcUrl` argument from the two calls in the test body (`relayerAddress()`, `opsAddress()`). Import `mnemonicToAccount` from `viem/accounts` and `abis` from `@/core/chain/abis` if not already imported.

- [ ] **Step 3: Run test to verify it fails**

Run: `PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/chain/__tests__/dev-chain.test.ts`
Expected: FAIL — operator is the zero address and owner is the deployer

- [ ] **Step 4: Wire the deploy script**

In `scripts/dev-chain.ts`, immediately after the `"set campaign escrow"` `waitForWrite` block and before the `return {`:

```ts
    const escrowAbi = abis.campaignEscrow;
    const relayerAccount = mnemonicToAccount(appMnemonic, {
        addressIndex: Number(process.env.RELAYER_WALLET_INDEX ?? 0),
    });
    const opsAccount = mnemonicToAccount(appMnemonic, {
        addressIndex: Number(process.env.OPS_WALLET_INDEX ?? 9000),
    });

    // Order matters: setCampaignOperator is onlyOwner and the deployer is
    // still the owner at this point.
    await waitForWrite(
        pub,
        await wallet.writeContract({
            address: campaignEscrow,
            abi: escrowAbi,
            functionName: "setCampaignOperator",
            args: [relayerAccount.address],
        }),
        "set campaign operator",
    );
    await waitForWrite(
        pub,
        await wallet.writeContract({
            address: campaignEscrow,
            abi: escrowAbi,
            functionName: "transferOwnership",
            args: [opsAccount.address],
        }),
        "transfer escrow ownership to ops",
    );
```

Also fund the ops account with gas, immediately before the two writes above, so it can send transactions on a fresh anvil:

```ts
    await waitForWrite(
        pub,
        await wallet.sendTransaction({
            to: opsAccount.address,
            value: parseEther("10"),
        } as never),
        "fund ops wallet",
    );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/chain/__tests__/dev-chain.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/dev-chain.ts src/core/chain/__tests__/dev-chain.test.ts
git commit -m "feat(chain): wire escrow operator and ops ownership at deploy"
```

---

### Task 3: Generalize the relayer_job schema

`relayer_job.orderId` is `NOT NULL`, `UNIQUE`, and foreign-keyed to `purchase_order`. Campaign operations have no purchase order.

**Files:**
- Modify: `src/server/drizzle/schemas/purchase-schema.ts:70-101`
- Create: migration under `drizzle/` (generated)
- Test: `src/core/chain/server/relayer/__tests__/job-schema.integration.test.ts`

**Interfaces:**
- Produces: `relayerJobKind` pg enum; `relayerJob.kind`, `relayerJob.idempotencyKey`; `orderId` nullable with a partial unique index scoped to `kind = 'consumption_record'`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/chain/server/relayer/__tests__/job-schema.integration.test.ts
import { describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";

const run = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeDb = describe.skipIf(!run);

describeDb("relayer_job generalization", () => {
    it("accepts a job with no purchase order", async () => {
        const key = `campaign_create:${crypto.randomUUID()}`;
        const [row] = await db
            .insert(relayerJob)
            .values({
                kind: "campaign_create",
                idempotencyKey: key,
                payload: { campaignId: "c1" },
            })
            .returning();

        expect(row.orderId).toBeNull();
        expect(row.kind).toBe("campaign_create");
    });

    it("rejects a duplicate idempotency key", async () => {
        const key = `campaign_create:${crypto.randomUUID()}`;
        await db.insert(relayerJob).values({
            kind: "campaign_create",
            idempotencyKey: key,
            payload: {},
        });

        await expect(
            db.insert(relayerJob).values({
                kind: "campaign_create",
                idempotencyKey: key,
                payload: {},
            }),
        ).rejects.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/core/chain/server/relayer/__tests__/job-schema.integration.test.ts`
Expected: FAIL — `kind` and `idempotency_key` do not exist

- [ ] **Step 3: Change the schema**

In `src/server/drizzle/schemas/purchase-schema.ts`, add above `relayerJob`:

```ts
export const relayerJobKind = pgEnum("relayer_job_kind", [
    "consumption_record",
    "campaign_create",
    "campaign_fund_approve",
    "campaign_fund",
    "campaign_publish",
    "voucher_unlock",
    "voucher_redeem",
]);
```

Replace the `orderId` field and the table's index array:

```ts
        orderId: text("order_id").references(() => purchaseOrder.id, {
            onDelete: "restrict",
        }),
        kind: relayerJobKind("kind").default("consumption_record").notNull(),
        idempotencyKey: text("idempotency_key").notNull().unique(),
```

```ts
    (t) => [
        index("relayer_job_status_retry_idx").on(t.status, t.nextRetryAt),
        // Preserves the old UNIQUE(order_id) guarantee for purchase jobs only.
        uniqueIndex("relayer_job_consumption_order_uq")
            .on(t.orderId)
            .where(sql`${t.kind} = 'consumption_record'`),
    ],
```

Add `pgEnum`, `uniqueIndex` and `sql` to the imports at the top of the file if missing.

- [ ] **Step 4: Generate and apply the migration**

```bash
pnpm db:generate
```

Read the generated SQL file under `drizzle/`. It must backfill `idempotency_key` for existing rows before adding the `NOT NULL` constraint. If the generated file adds the column as `NOT NULL` in one statement, edit the generated migration to run in this order:

```sql
ALTER TABLE "relayer_job" ADD COLUMN "idempotency_key" text;
UPDATE "relayer_job" SET "idempotency_key" = 'consumption:' || "order_id" WHERE "idempotency_key" IS NULL;
ALTER TABLE "relayer_job" ALTER COLUMN "idempotency_key" SET NOT NULL;
```

Then apply against a fresh database:

```bash
createdb punch_plan_verify
DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify pnpm db:migrate
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify pnpm vitest run src/core/chain/server/relayer/__tests__/job-schema.integration.test.ts`
Expected: PASS

- [ ] **Step 6: Update the one existing insert site**

`src/core/purchase/server/repository/purchase-repository.ts:180` inserts a job. Change it to:

```ts
            await tx.insert(relayerJob).values({
                orderId,
                kind: "consumption_record",
                idempotencyKey: `consumption:${orderId}`,
                payload,
            });
```

- [ ] **Step 7: Verify the full suite**

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/server/drizzle/schemas/purchase-schema.ts src/core/purchase/server/repository/purchase-repository.ts drizzle/
git commit -m "feat(chain): generalize relayer_job beyond purchase orders"
```

---

### Task 4: Generic job repository

Move the job state machine out of `purchase-repository.ts`, keeping the purchase-order coupling as a caller-supplied side effect so both state machines still move in one transaction.

**Files:**
- Create: `src/core/chain/server/relayer/job-repository.ts`
- Modify: `src/core/purchase/server/repository/purchase-repository.ts:303-460` (delete the moved functions, re-export the purchase side effects)
- Test: `src/core/chain/server/relayer/__tests__/job-repository.integration.test.ts`

**Interfaces:**
- Produces:
  - `RELAYER_CLAIM_LEASE_MS: number`
  - `type JobSideEffect = (tx: JobTransaction, job: RelayerJobRow) => Promise<void>`
  - `enqueueJob(tx: JobTransaction, input: { kind: RelayerJobKind; idempotencyKey: string; payload: unknown; orderId?: string }): Promise<RelayerJobRow | null>` — returns `null` when the key already exists
  - `findJobsToRun(limit: number, leaseMs?: number): Promise<RelayerJobRow[]>`
  - `claimSubmittedJobs(limit: number, leaseMs?: number): Promise<RelayerJobRow[]>`
  - `markJobSubmitted(id: string, txHash: string, nextRetryAt: Date, sideEffect?: JobSideEffect): Promise<RelayerJobRow | null>`
  - `markJobConfirmed(id: string, sideEffect?: JobSideEffect): Promise<RelayerJobRow | null>`
  - `markJobRetry(id: string, error: string, attempts: number, nextRetryAt: Date): Promise<unknown>`
  - `markJobFailed(id: string, error: string, failureReason: string, sideEffect?: JobSideEffect): Promise<unknown>`
  - `markJobPending(id: string, nextRetryAt: Date, sideEffect?: JobSideEffect): Promise<unknown>`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/chain/server/relayer/__tests__/job-repository.integration.test.ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
    enqueueJob,
    findJobsToRun,
    markJobConfirmed,
} from "@/core/chain/server/relayer/job-repository";
import { db } from "@/server/drizzle/db";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";

const run = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeDb = describe.skipIf(!run);

describeDb("job repository", () => {
    it("enqueues once per idempotency key", async () => {
        const key = `campaign_create:${crypto.randomUUID()}`;
        const first = await enqueueJob(db, {
            kind: "campaign_create",
            idempotencyKey: key,
            payload: { campaignId: "c1" },
        });
        const second = await enqueueJob(db, {
            kind: "campaign_create",
            idempotencyKey: key,
            payload: { campaignId: "c1" },
        });

        expect(first).not.toBeNull();
        expect(second).toBeNull();
    });

    it("runs the side effect inside the confirm transaction", async () => {
        const key = `campaign_publish:${crypto.randomUUID()}`;
        const job = await enqueueJob(db, {
            kind: "campaign_publish",
            idempotencyKey: key,
            payload: {},
        });
        if (!job) throw new Error("enqueue failed");

        let sawJobId = "";
        await markJobConfirmed(job.id, async (_tx, confirmed) => {
            sawJobId = confirmed.id;
        });

        const [row] = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.id, job.id));
        expect(row.status).toBe("confirmed");
        expect(sawJobId).toBe(job.id);
    });

    it("claims pending jobs of any kind", async () => {
        await enqueueJob(db, {
            kind: "voucher_unlock",
            idempotencyKey: `voucher_unlock:${crypto.randomUUID()}`,
            payload: {},
        });
        const claimed = await findJobsToRun(10);
        expect(claimed.some((j) => j.kind === "voucher_unlock")).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify pnpm vitest run src/core/chain/server/relayer/__tests__/job-repository.integration.test.ts`
Expected: FAIL — cannot find module `job-repository`

- [ ] **Step 3: Write the generic repository**

Create `src/core/chain/server/relayer/job-repository.ts`. Move `claimJobsByStatus`, `findJobsToRun`, `claimSubmittedJobs` verbatim from `purchase-repository.ts:303-350`, then write the mark functions with the side-effect seam:

```ts
import "server-only";

import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import {
    type RelayerJobRow,
    relayerJob,
} from "@/server/drizzle/schemas/purchase-schema";

export const RELAYER_CLAIM_LEASE_MS = 60_000;

export type JobTransaction = Pick<
    typeof db,
    "select" | "insert" | "update"
>;
export type JobSideEffect = (
    tx: JobTransaction,
    job: RelayerJobRow,
) => Promise<void>;
export type RelayerJobKind = RelayerJobRow["kind"];

export async function enqueueJob(
    tx: JobTransaction,
    input: {
        kind: RelayerJobKind;
        idempotencyKey: string;
        payload: unknown;
        orderId?: string;
    },
): Promise<RelayerJobRow | null> {
    const [row] = await tx
        .insert(relayerJob)
        .values({
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
            payload: input.payload,
            orderId: input.orderId,
        })
        .onConflictDoNothing({ target: relayerJob.idempotencyKey })
        .returning();
    return row ?? null;
}

export async function markJobConfirmed(
    id: string,
    sideEffect?: JobSideEffect,
): Promise<RelayerJobRow | null> {
    return db.transaction(async (tx) => {
        const [job] = await tx
            .update(relayerJob)
            .set({ status: "confirmed", lastError: null })
            .where(
                and(
                    eq(relayerJob.id, id),
                    inArray(relayerJob.status, ["pending", "submitted"]),
                ),
            )
            .returning();
        if (!job) return null;
        if (sideEffect) await sideEffect(tx, job);
        return job;
    });
}
```

Write `markJobSubmitted`, `markJobRetry`, `markJobFailed` and `markJobPending` following the same shape: update the `relayer_job` row under the same status guards the current code uses, then call the side effect inside the transaction. `markJobRetry` takes no side effect.

- [ ] **Step 4: Move the purchase coupling into side effects**

In `purchase-repository.ts`, delete the moved functions and export the purchase-order transitions instead. Each preserves the throw-on-rejected semantics the current code relies on:

```ts
export const purchaseJobSideEffects = {
    submitted:
        (txHash: string): JobSideEffect =>
        async (tx, job) => {
            if (!job.orderId) return;
            const [order] = await tx
                .update(purchaseOrder)
                .set({ status: "submitted", txHash, failureReason: null })
                .where(
                    and(
                        eq(purchaseOrder.id, job.orderId),
                        eq(purchaseOrder.status, "queued"),
                    ),
                )
                .returning({ id: purchaseOrder.id });
            if (!order) {
                throw new Error("relayer submitted order transition rejected");
            }
        },
};
```

Add `confirmed`, `failed` and `pending` members mirroring the transitions currently in `markJobConfirmed`, `markJobFailed` and `markJobPending`, including the idempotent-already-confirmed branch that returns instead of throwing.

Update every import site to pull the job functions from `job-repository` — `relayer.ts` and the existing relayer tests.

- [ ] **Step 5: Run the tests**

Run: `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify pnpm test`
Expected: PASS, including the existing `relayer.integration.test.ts` unchanged in behavior

- [ ] **Step 6: Commit**

```bash
git add src/core/chain/server/relayer/job-repository.ts src/core/purchase/server/repository/purchase-repository.ts src/core/chain/server/relayer/__tests__/job-repository.integration.test.ts
git commit -m "refactor(chain): extract generic relayer job repository"
```

---

### Task 5: Handler contract and generic drain

**Files:**
- Create: `src/core/chain/server/relayer/handlers/types.ts`
- Create: `src/core/chain/server/relayer/handlers/registry.ts`
- Create: `src/core/chain/server/relayer/handlers/consumption-record.ts`
- Create: `src/core/chain/server/relayer/signers.ts`
- Modify: `src/core/chain/server/relayer/relayer.ts` (whole file)
- Test: `src/core/chain/server/relayer/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `job-repository.ts` exports from Task 4; `deriveOpsAccount()` from Task 1
- Produces:

```ts
export type JobSigner =
    | { kind: "relayer" }
    | { kind: "ops" }
    | { kind: "wallet"; walletIndex: number };

export type JobCall = {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
};

export type JobFailure = { code: RevertCode; message: string };

export type JobContext = {
    addresses: AddressMap;
    pub: Pick<PublicClient, "readContract" | "simulateContract" | "getLogs">;
    now: () => Date;
};

export type JobHandler = {
    kind: RelayerJobKind;
    signer(job: RelayerJobRow): JobSigner;
    call(job: RelayerJobRow, ctx: JobContext): Promise<JobCall>;
    preflight?(job: RelayerJobRow, ctx: JobContext): Promise<JobFailure | null>;
    /** Reverts meaning the chain already holds the desired state. */
    idempotentCodes?: ReadonlySet<RevertCode>;
    onSubmitted?(job: RelayerJobRow, txHash: Hex): JobSideEffect | undefined;
    onConfirmed?(job: RelayerJobRow, receipt: TransactionReceipt): JobSideEffect | undefined;
    onFailed?(job: RelayerJobRow, failure: JobFailure): JobSideEffect | undefined;
};

export function handlerFor(kind: RelayerJobKind): JobHandler;
export function resolveSigner(signer: JobSigner): Account;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/core/chain/server/relayer/__tests__/registry.test.ts
import { describe, expect, it } from "vitest";
import { handlerFor } from "../handlers/registry";

describe("handler registry", () => {
    it("returns the handler registered for a kind", () => {
        expect(handlerFor("consumption_record").kind).toBe(
            "consumption_record",
        );
    });

    it("throws for a kind with no handler yet", () => {
        // Campaign kinds land in Tasks 9-13. Until then an unregistered kind
        // must fail loudly rather than resolve to a stub.
        expect(() => handlerFor("campaign_create")).toThrow(
            /unsupported relayer job kind/,
        );
    });

    it("signs consumption jobs with the relayer key", () => {
        expect(
            handlerFor("consumption_record").signer({} as never),
        ).toEqual({ kind: "relayer" });
    });

    it("throws on an unknown kind", () => {
        expect(() => handlerFor("nope" as never)).toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/chain/server/relayer/__tests__/registry.test.ts`
Expected: FAIL — cannot find module `../handlers/registry`

- [ ] **Step 3: Write types, signers, and the consumption handler**

`handlers/types.ts` holds the type block from the Interfaces section above.

`signers.ts`:

```ts
import "server-only";
import type { Account } from "viem";
import { env } from "@/config/env";
import { deriveOpsAccount } from "@/core/chain/server/wallet/ops-account";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import type { JobSigner } from "./handlers/types";

export function resolveSigner(signer: JobSigner): Account {
    switch (signer.kind) {
        case "relayer":
            return deriveUserAccount(env.RELAYER_WALLET_INDEX);
        case "ops":
            return deriveOpsAccount();
        case "wallet":
            return deriveUserAccount(signer.walletIndex);
    }
}
```

`handlers/consumption-record.ts` moves today's behavior out of `relayer.ts` unchanged: `parseSubmission`, the `recordConsumption` call, the `replaySubmissionError` simulation, `hasRecordedProof` as the `nonce_used` idempotency check, and the purchase side effects from Task 4 wired into `onSubmitted` / `onConfirmed` / `onFailed`.

`handlers/registry.ts` maps kind → handler and throws `new Error("unsupported relayer job kind " + kind)` on a miss. Register only `consumption_record`; each later task registers its own handler as it lands. Do not add placeholder or stub handlers for the campaign kinds — an unregistered kind must fail loudly.

- [ ] **Step 4: Rewrite the drain**

`relayer.ts` keeps `runRelayerOnce` and `recoverStuckJobs` with the same signatures and the same retry, lease and failure-classification logic. Every place that mentioned `consumptionLog` or `recordConsumption` now goes through `handlerFor(job.kind)`. Specifically:

- Before submitting, run `handler.preflight?.(job, ctx)`; a non-null result fails the job permanently with that code and message.
- Build the write from `await handler.call(job, ctx)`.
- On revert, if `handler.idempotentCodes?.has(code)`, confirm the job instead of failing it.
- Pass `handler.onSubmitted/onConfirmed/onFailed` results as the `sideEffect` argument to the corresponding `markJob*` call.

- [ ] **Step 5: Run the tests**

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: PASS — the existing `relayer.test.ts` and `relayer.integration.test.ts` must still pass unchanged, since behavior for `consumption_record` is preserved

- [ ] **Step 6: Commit**

```bash
git add src/core/chain/server/relayer/
git commit -m "refactor(chain): dispatch relayer jobs through per-kind handlers"
```

- [ ] **Step 7: Notify the parallel sessions**

The rail is now shared. Send this via `SendMessage` to the sessions working on PUNCH redemption and plan payment:

> El rail de relayer está generalizado en la rama `campaign-escrow-runtime`: `relayer_job` tiene `kind` + `idempotency_key`, `order_id` es nullable, y `relayer.ts` despacha por handler (`src/core/chain/server/relayer/handlers/`). Para agregar una op nueva: registrá un `JobHandler` y encolá con `enqueueJob`. Mergeen esto antes de tocar `relayer.ts` para no resolver el mismo problema tres veces.

---

### Task 6: Campaign schema and projection table

**Files:**
- Modify: `src/server/drizzle/schemas/punch-schema.ts:66-89` (campaign), `:97-128` (consumerVoucher), `:41-63` (chainPurchaseEffect)
- Modify: `src/server/drizzle/schemas/chain-schema.ts` (add `projectionCampaign`)
- Create: migration under `drizzle/` (generated)
- Test: `src/server/drizzle/__tests__/campaign-schema.integration.test.ts`

**Interfaces:**
- Produces: `campaign.chainCampaignId`, `campaign.voucherPayout`, `campaign.maxVouchers`; `projectionCampaign` table; `consumerVoucher.chainUnlockTxHash`; `chainPurchaseEffect.failureReason`; types `ProjectionCampaignRow`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/drizzle/__tests__/campaign-schema.integration.test.ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";

const run = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeDb = describe.skipIf(!run);

describeDb("campaign projection schema", () => {
    it("stores escrow state keyed by chain campaign id", async () => {
        await db.insert(projectionCampaign).values({
            chainCampaignId: 1,
            status: "draft",
            budget: 0n,
            voucherPayout: 0n,
            maxVouchers: 0,
            expiry: new Date(0),
            unlockedCount: 0,
            redeemedCount: 0,
            lastBlock: 1n,
        });

        const [row] = await db
            .select()
            .from(projectionCampaign)
            .where(eq(projectionCampaign.chainCampaignId, 1));

        expect(row.status).toBe("draft");
        expect(row.budget).toBe(0n);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify pnpm vitest run src/server/drizzle/__tests__/campaign-schema.integration.test.ts`
Expected: FAIL — `projectionCampaign` is not exported

- [ ] **Step 3: Add the projection table**

In `src/server/drizzle/schemas/chain-schema.ts`:

```ts
export const campaignProjectionStatus = pgEnum("campaign_projection_status", [
    "draft",
    "published",
    "cancelled",
]);

export const projectionCampaign = pgTable("projection_campaign", {
    chainCampaignId: integer("chain_campaign_id").primaryKey(),
    status: campaignProjectionStatus("status").notNull(),
    budget: bigint("budget", { mode: "bigint" }).notNull(),
    voucherPayout: bigint("voucher_payout", { mode: "bigint" })
        .default(sql`0`)
        .notNull(),
    maxVouchers: integer("max_vouchers").default(0).notNull(),
    expiry: timestamp("expiry").notNull(),
    unlockedCount: integer("unlocked_count").default(0).notNull(),
    redeemedCount: integer("redeemed_count").default(0).notNull(),
    lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
});

export type ProjectionCampaignRow = typeof projectionCampaign.$inferSelect;
```

Add `pgEnum` to the imports.

- [ ] **Step 4: Extend the punch schema**

In `punch-schema.ts`, add to `campaign`:

```ts
        chainCampaignId: integer("chain_campaign_id").unique(),
        voucherPayout: bigint("voucher_payout", { mode: "bigint" }),
        maxVouchers: integer("max_vouchers"),
```

Add to `consumerVoucher`:

```ts
        chainUnlockTxHash: text("chain_unlock_tx_hash"),
```

Add to `chainPurchaseEffect`:

```ts
        failureReason: text("failure_reason"),
```

Add `bigint` to the imports if missing.

- [ ] **Step 5: Generate, apply, and verify**

```bash
pnpm db:generate
dropdb --if-exists punch_plan_verify && createdb punch_plan_verify
DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify pnpm db:migrate
PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify pnpm vitest run src/server/drizzle/__tests__/campaign-schema.integration.test.ts
```

Expected: migration applies on an empty database, test PASSES

- [ ] **Step 6: Commit**

```bash
git add src/server/drizzle/schemas/ drizzle/ src/server/drizzle/__tests__/campaign-schema.integration.test.ts
git commit -m "feat(campaign): add chain link columns and escrow projection table"
```

---

### Task 7: Escrow event projection

**Files:**
- Create: `src/core/chain/server/indexer/campaign-projection.ts`
- Modify: `src/core/chain/server/indexer/apply-event.ts:19-31` (event union), `:182-201` (dispatch)
- Modify: `src/core/chain/server/indexer/indexer.ts:66-74` (sources)
- Test: `src/core/chain/server/indexer/__tests__/campaign-projection.test.ts`

**Interfaces:**
- Consumes: `projectionCampaign` from Task 6
- Produces: `applyCampaignEvent(tx: IndexerTransaction, event: IndexerEvent): Promise<void>`; `IndexerEvent["eventName"]` gains `CampaignCreated`, `CampaignFunded`, `CampaignPublished`, `VoucherUnlocked`, `VoucherRedeemed`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/chain/server/indexer/__tests__/campaign-projection.test.ts
import { describe, expect, it, vi } from "vitest";
import { applyCampaignEvent } from "../campaign-projection";

function fakeTx() {
    const calls: { table: string; values: unknown }[] = [];
    const chainable = {
        values: (v: unknown) => ({
            onConflictDoUpdate: () => {
                calls.push({ table: "insert", values: v });
                return Promise.resolve();
            },
            onConflictDoNothing: () => Promise.resolve(),
            returning: () => Promise.resolve([]),
        }),
        set: () => ({ where: () => ({ returning: () => Promise.resolve([{}]) }) }),
        from: () => ({ where: () => Promise.resolve([]) }),
    };
    return {
        calls,
        tx: {
            insert: () => chainable,
            update: () => chainable,
            select: () => chainable,
        } as never,
    };
}

const base = {
    blockNumber: 10n,
    transactionHash: "0xabc",
    logIndex: 0,
    transactionIndex: 0,
};

describe("applyCampaignEvent", () => {
    it("creates a draft projection row on CampaignCreated", async () => {
        const { tx, calls } = fakeTx();
        await applyCampaignEvent(tx, {
            ...base,
            eventName: "CampaignCreated",
            args: { campaignId: 1n, sourceCafeId: 2n },
        });
        expect(calls[0].values).toMatchObject({
            chainCampaignId: 1,
            status: "draft",
            budget: 0n,
        });
    });

    it("rejects a campaign id that overflows a SQL integer", async () => {
        const { tx } = fakeTx();
        await expect(
            applyCampaignEvent(tx, {
                ...base,
                eventName: "CampaignCreated",
                args: { campaignId: 2n ** 40n, sourceCafeId: 1n },
            }),
        ).rejects.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/chain/server/indexer/__tests__/campaign-projection.test.ts`
Expected: FAIL — cannot find module `../campaign-projection`

- [ ] **Step 3: Write the projection**

`campaign-projection.ts` exports `applyCampaignEvent` with a switch over the five events. Reuse the existing `cafeId`-style integer guard from `apply-event.ts` for campaign ids (copy the `MAX_SQL_INT` check — a campaign id is a `uint256` on chain and must not silently truncate).

- `CampaignCreated` — insert `{ chainCampaignId, status: "draft", budget: 0n, voucherPayout: 0n, maxVouchers: 0, expiry: new Date(0), unlockedCount: 0, redeemedCount: 0, lastBlock }`, `onConflictDoUpdate` setting only `lastBlock` to `GREATEST(...)` so a reindex is idempotent.
- `CampaignFunded` — `budget = budget + amount`, `lastBlock = GREATEST(...)`. Guard against applying an older block: add `WHERE last_block < ${block}` so replays do not double-count.
- `CampaignPublished` — set `status = 'published'`, `voucherPayout`, `maxVouchers`, `expiry = to_timestamp(expiry)`.
- `VoucherUnlocked` — increment `unlockedCount`, then insert the `consumer_voucher` row with `source: "campaign"`, `expiresAt` = the projection's `expiry`, and `chainUnlockTxHash` = `event.transactionHash`, then set that voucher's id on the matching `chain_purchase_effect.createdVoucherId`. Resolve the user by `lower(user.wallet_address)` and the campaign by `campaign.chain_campaign_id`. Use `onConflictDoNothing` on the `(campaign_id, consumer_user_id)` unique index so a reindex does not duplicate the voucher.
- `VoucherRedeemed` — increment `redeemedCount`, `budget = budget - voucherPayout`, and set the voucher to `redeemed` with `redeemedAt`.

Because the whole indexer batch runs in one transaction and `CampaignFunded` events are additive, use the `last_block` guard rather than an events-seen table.

- [ ] **Step 4: Register the source and dispatch**

In `apply-event.ts`, extend the `eventName` union with the five names and add to the `switch`:

```ts
        case "CampaignCreated":
        case "CampaignFunded":
        case "CampaignPublished":
        case "VoucherUnlocked":
        case "VoucherRedeemed":
            return applyCampaignEvent(tx, event);
```

In `indexer.ts`, add to `sources`:

```ts
    source("campaignEscrow", abis.campaignEscrow, [
        "CampaignCreated",
        "CampaignFunded",
        "CampaignPublished",
        "VoucherUnlocked",
        "VoucherRedeemed",
    ]),
```

- [ ] **Step 5: Run the tests**

Run: `pnpm check && pnpm typecheck && pnpm vitest run src/core/chain/server/indexer/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/chain/server/indexer/
git commit -m "feat(chain): project CampaignEscrow events into Postgres"
```

---

### Task 8: Campaign domain and repository

**Files:**
- Create: `src/core/campaign/domain/types.ts`, `domain/schemas.ts`, `domain/transitions.ts`
- Create: `src/core/campaign/server/repository/campaign-repository.ts`
- Test: `src/core/campaign/domain/__tests__/schemas.test.ts`, `domain/__tests__/transitions.test.ts`

**Interfaces:**
- Consumes: `campaign`, `projectionCampaign` from Task 6
- Produces:

```ts
export type CampaignLifecycle = "creating" | "draft" | "published" | "cancelled";
export type CampaignParams = {
    name: string;
    windowStart: Date;
    windowEnd: Date;
    voucherPayout: bigint;
    maxVouchers: number;
};
export const createCampaignSchema: z.ZodType<CampaignParams>;
export function requiredBudget(params: Pick<CampaignParams, "voucherPayout" | "maxVouchers">): bigint;
export function lifecycleOf(link: { chainCampaignId: number | null }, projection: ProjectionCampaignRow | null): CampaignLifecycle;
export function canPublish(projection: ProjectionCampaignRow | null, required: bigint): boolean;

// repository
export function insertCampaign(tx, values): Promise<CampaignRow>;
export function linkChainCampaign(tx, campaignId: string, chainCampaignId: number): Promise<void>;
export function findCampaignById(campaignId: string): Promise<CampaignRow | null>;
export function findCampaignWithProjection(campaignId: string): Promise<{ campaign: CampaignRow; projection: ProjectionCampaignRow | null } | null>;
export function listCafeCampaigns(cafeId: string): Promise<{ campaign: CampaignRow; projection: ProjectionCampaignRow | null }[]>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/campaign/domain/__tests__/transitions.test.ts
import { describe, expect, it } from "vitest";
import { canPublish, lifecycleOf, requiredBudget } from "../transitions";

const projection = {
    chainCampaignId: 1,
    status: "draft" as const,
    budget: 500n,
    voucherPayout: 0n,
    maxVouchers: 0,
    expiry: new Date(0),
    unlockedCount: 0,
    redeemedCount: 0,
    lastBlock: 1n,
};

describe("requiredBudget", () => {
    it("multiplies payout by cap", () => {
        expect(requiredBudget({ voucherPayout: 50n, maxVouchers: 10 })).toBe(
            500n,
        );
    });
});

describe("lifecycleOf", () => {
    it("is creating until the chain id lands", () => {
        expect(lifecycleOf({ chainCampaignId: null }, null)).toBe("creating");
    });

    it("is draft once created on chain", () => {
        expect(lifecycleOf({ chainCampaignId: 1 }, projection)).toBe("draft");
    });

    it("is published once the escrow says so", () => {
        expect(
            lifecycleOf(
                { chainCampaignId: 1 },
                { ...projection, status: "published" },
            ),
        ).toBe("published");
    });
});

describe("canPublish", () => {
    it("requires the chain budget to cover every promised voucher", () => {
        expect(canPublish(projection, 500n)).toBe(true);
        expect(canPublish(projection, 501n)).toBe(false);
    });

    it("refuses a campaign that is not a draft", () => {
        expect(
            canPublish({ ...projection, status: "published" }, 500n),
        ).toBe(false);
    });

    it("refuses when the chain has not confirmed creation", () => {
        expect(canPublish(null, 0n)).toBe(false);
    });
});
```

```ts
// src/core/campaign/domain/__tests__/schemas.test.ts
import { describe, expect, it } from "vitest";
import { createCampaignSchema } from "../schemas";

const valid = {
    name: "Primera visita",
    windowStart: new Date("2026-09-01T00:00:00Z"),
    windowEnd: new Date("2026-09-30T00:00:00Z"),
    voucherPayout: 5_000_000n,
    maxVouchers: 20,
};

describe("createCampaignSchema", () => {
    it("accepts a well formed campaign", () => {
        expect(createCampaignSchema.parse(valid)).toMatchObject({
            maxVouchers: 20,
        });
    });

    it("rejects an inverted window", () => {
        expect(() =>
            createCampaignSchema.parse({
                ...valid,
                windowEnd: new Date("2026-08-01T00:00:00Z"),
            }),
        ).toThrow();
    });

    it("rejects a zero payout or cap, which publishCampaign would revert on", () => {
        expect(() =>
            createCampaignSchema.parse({ ...valid, voucherPayout: 0n }),
        ).toThrow();
        expect(() =>
            createCampaignSchema.parse({ ...valid, maxVouchers: 0 }),
        ).toThrow();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/core/campaign/domain/`
Expected: FAIL — modules not found

- [ ] **Step 3: Write the domain**

`transitions.ts`:

```ts
export function requiredBudget(params: {
    voucherPayout: bigint;
    maxVouchers: number;
}): bigint {
    return params.voucherPayout * BigInt(params.maxVouchers);
}

export function lifecycleOf(
    link: { chainCampaignId: number | null },
    projection: ProjectionCampaignRow | null,
): CampaignLifecycle {
    if (link.chainCampaignId === null || !projection) return "creating";
    return projection.status;
}

export function canPublish(
    projection: ProjectionCampaignRow | null,
    required: bigint,
): boolean {
    if (!projection) return false;
    if (projection.status !== "draft") return false;
    return projection.budget >= required;
}
```

`schemas.ts` uses zod with a `superRefine` for the window order and positive bounds on `voucherPayout` and `maxVouchers`. `maxVouchers` must also be `.int().max(2_147_483_647)` so it fits the SQL integer used by the projection.

`campaign-repository.ts` implements the listed functions with Drizzle, joining `campaign` to `projectionCampaign` on `campaign.chainCampaignId`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/core/campaign/domain/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/campaign/
git commit -m "feat(campaign): add campaign domain and repository"
```

---

### Task 8b: At-most-once sending for non-idempotent calls

Four of the six escrow operations are safe to resend: `publishCampaign` reverts `NotDraft`, `unlockVoucher` reverts `VoucherAlreadyUnlocked`, `redeemVoucher` reverts `VoucherAlreadyRedeemed`, and `approve` sets an allowance rather than adding to it. Two are not. `createCampaign` does not revert on a resend — it creates a second campaign. `fundCampaign` does not revert either — it transfers the café's mPEN a second time.

There are two independent doors to the double send, and both must close.

The first is a crash between `writeContract` broadcasting and `markJobSubmitted` persisting the hash. The job is left `pending` with no hash, and the next drain re-signs with a fresh nonce, producing a genuinely different transaction that executes again.

The second needs no crash at all. In `recoverStuckJobs`, a missing receipt requeues the job to `pending` (`relayer.ts`, the `isMissingReceiptError` branch), and `runRelayerOnce` then re-signs and re-broadcasts it. A slow network is enough. This one is invisible today because the only kind on the rail is `consumption_record`, whose replay reverts on its proof nonce.

`idempotentCodes` cannot help with either: there is no revert to classify.

**Files:**
- Modify: `src/server/drizzle/schemas/purchase-schema.ts` (add `signedTx text` to `relayer_job`)
- Modify: `src/core/chain/server/relayer/handlers/types.ts` (add `idempotentOnChain?: boolean` to `JobHandler`)
- Modify: `src/core/chain/server/relayer/job-repository.ts` (persist the signed payload)
- Modify: `src/core/chain/server/relayer/relayer.ts` (sign → persist → broadcast; rebroadcast on recovery)
- Create: migration under `drizzle/` (generated)
- Test: `src/core/chain/server/relayer/__tests__/at-most-once.test.ts`

**Interfaces:**
- Produces: `JobHandler.idempotentOnChain?: boolean` — omitted or `true` keeps today's broadcast-then-persist path; `false` selects the persisted-payload path.
- Produces: `markJobSigned(id: string, txHash: string, signedTx: string): Promise<RelayerJobRow | null>`

- [ ] **Step 1: Write the failing test**

The test drives a handler declaring `idempotentOnChain: false` through a simulated crash: sign and persist succeed, the broadcast throws, and the job is left `pending` with a hash and payload recorded. Then the recovery path runs and must rebroadcast the **same bytes**, not re-sign.

```ts
    it("rebroadcasts the persisted bytes instead of re-signing", async () => {
        const signCalls: unknown[] = [];
        const sent: string[] = [];
        const deps = depsFor({
            handler: { ...nonIdempotentHandler },
            signTransaction: async (args: unknown) => {
                signCalls.push(args);
                return "0xdeadbeef";
            },
            sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: string }) => {
                sent.push(serializedTransaction);
                if (sent.length === 1) throw new Error("connection reset");
                return "0xhash";
            },
        });

        await runRelayerOnce(deps);
        await recoverStuckJobs(deps);

        expect(signCalls).toHaveLength(1);
        expect(sent).toEqual(["0xdeadbeef", "0xdeadbeef"]);
    });

    it("never persists a signed payload for an idempotent handler", async () => {
        const deps = depsFor({ handler: consumptionRecordHandler });
        await runRelayerOnce(deps);
        const [job] = await db.select().from(relayerJob).where(eq(relayerJob.id, jobId));
        expect(job.signedTx).toBeNull();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/chain/server/relayer/__tests__/at-most-once.test.ts`
Expected: FAIL — `signedTx` does not exist, and the drain always re-signs

- [ ] **Step 3: Add the column**

Add `signedTx: text("signed_tx")` to `relayerJob`, generate the migration with `pnpm db:generate`, and apply it to a freshly created database.

- [ ] **Step 4: Split the send path**

In `submitJob`, when `handler.idempotentOnChain === false`: build the request with `wallet.prepareTransactionRequest`, sign it with `wallet.signTransaction`, persist hash and serialized payload via `markJobSigned`, and only then `pub.sendRawTransaction`. When the flag is absent or true, keep today's `writeContract` path unchanged so the purchase flow is untouched.

In `recoverStuckJobs`, a job carrying `signedTx` rebroadcasts those exact bytes and never re-signs. A job with no hash and no payload requeues as today.

Close the second door too: for a handler with `idempotentOnChain === false`, `submitJob` must never sign a job that already carries a `signedTx` — it rebroadcasts the stored bytes instead. Otherwise the missing-receipt requeue in `recoverStuckJobs` hands the job straight back to `submitJob`, which signs again. Add a test that requeues a non-idempotent job through the missing-receipt path, runs the drain, and asserts the signing function was called exactly once across both passes.

- [ ] **Step 5: Handle the nonce hazard explicitly**

The persisted payload pins the relayer's account nonce. If another job consumes that nonce meanwhile, the rebroadcast fails with "nonce too low". Never re-sign with a fresh nonce on that path — that is exactly the double-send this task prevents. Instead classify it as a distinct permanent code `superseded`, and have the handler's `onFailed` record a reason the UI can render as "no se pudo enviar, volvé a intentar". Add a test asserting a "nonce too low" rebroadcast lands as `superseded` and not as a retry.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm check && pnpm typecheck && pnpm test`, then the serial integration command.

```bash
git add src/core/chain/server/relayer/ src/server/drizzle/schemas/purchase-schema.ts drizzle/
git commit -m "feat(chain): send non-idempotent calls at most once"
```

---

### Task 9: Create campaign — service and handler

The escrow's `CampaignCreated` event carries only `campaignId` and `sourceCafeId`, neither of which identifies the Postgres row. The job correlates them from its own transaction receipt.

**Files:**
- Create: `src/core/campaign/server/services/create-campaign-service.ts`
- Create: `src/core/chain/server/relayer/handlers/campaign-create.ts`
- Modify: `src/core/chain/server/relayer/handlers/registry.ts`
- Test: `src/core/campaign/server/services/__tests__/create-campaign-service.test.ts`, `src/core/chain/server/relayer/handlers/__tests__/campaign-create.test.ts`

**Interfaces:**
- Consumes: `insertCampaign`, `linkChainCampaign` (Task 8); `enqueueJob` (Task 4); `JobHandler` (Task 5)
- Produces: `createCampaignService(userId: string, cafeId: string, input: CampaignParams): AsyncAppResult<{ campaignId: string }>`; job payload `{ campaignId: string; chainCafeId: number }`

- [ ] **Step 1: Write the failing handler test**

```ts
// src/core/chain/server/relayer/handlers/__tests__/campaign-create.test.ts
import { encodeEventTopics } from "viem";
import { describe, expect, it, vi } from "vitest";
import { abis } from "@/core/chain/abis";
import { campaignCreateHandler } from "../campaign-create";

const job = {
    id: "job-1",
    kind: "campaign_create" as const,
    payload: { campaignId: "camp-1", chainCafeId: 7 },
};

describe("campaign_create handler", () => {
    it("signs with the ops key", () => {
        expect(campaignCreateHandler.signer(job as never)).toEqual({
            kind: "ops",
        });
    });

    it("calls createCampaign with the chain cafe id", async () => {
        const call = await campaignCreateHandler.call(job as never, {
            addresses: { campaignEscrow: "0x1111111111111111111111111111111111111111" },
        } as never);
        expect(call.functionName).toBe("createCampaign");
        expect(call.args).toEqual([7n]);
    });

    it("reads the new campaign id from its own receipt", async () => {
        const topics = encodeEventTopics({
            abi: abis.campaignEscrow,
            eventName: "CampaignCreated",
            args: { campaignId: 42n, sourceCafeId: 7n },
        });
        const receipt = {
            logs: [
                {
                    address: "0x1111111111111111111111111111111111111111",
                    topics,
                    data: "0x",
                },
            ],
        };

        const link = vi.fn();
        const sideEffect = campaignCreateHandler.onConfirmed?.(
            job as never,
            receipt as never,
        );
        await sideEffect?.({ update: () => link() } as never, job as never);
        expect(link).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/chain/server/relayer/handlers/__tests__/campaign-create.test.ts`
Expected: FAIL — cannot find module `../campaign-create`

- [ ] **Step 3: Write the handler**

```ts
// src/core/chain/server/relayer/handlers/campaign-create.ts
import { parseEventLogs } from "viem";
import { abis } from "@/core/chain/abis";
import { linkChainCampaign } from "@/core/campaign/server/repository/campaign-repository";
import type { JobHandler } from "./types";

const MAX_SQL_INT = 2_147_483_647;

type Payload = { campaignId: string; chainCafeId: number };

function payloadOf(job: { payload: unknown }): Payload {
    const value = job.payload as Partial<Payload>;
    if (typeof value?.campaignId !== "string" || typeof value?.chainCafeId !== "number") {
        throw new Error("invalid payload");
    }
    return value as Payload;
}

export const campaignCreateHandler: JobHandler = {
    kind: "campaign_create",
    signer: () => ({ kind: "ops" }),
    async call(job, ctx) {
        const { chainCafeId } = payloadOf(job);
        return {
            address: ctx.addresses.campaignEscrow,
            abi: abis.campaignEscrow,
            functionName: "createCampaign",
            args: [BigInt(chainCafeId)],
        };
    },
    onConfirmed(job, receipt) {
        const { campaignId } = payloadOf(job);
        // The event carries no Postgres id, but this receipt belongs to this
        // job, so the correlation is exact. Reading nextCampaignId before
        // sending would race with a concurrent create.
        const [event] = parseEventLogs({
            abi: abis.campaignEscrow,
            logs: receipt.logs,
            eventName: "CampaignCreated",
            strict: true,
        });
        if (!event) throw new Error("createCampaign receipt has no CampaignCreated");
        const chainCampaignId = (event.args as { campaignId: bigint }).campaignId;
        if (chainCampaignId > BigInt(MAX_SQL_INT)) {
            throw new Error("chain campaign id overflows SQL integer");
        }
        return async (tx) => {
            await linkChainCampaign(tx, campaignId, Number(chainCampaignId));
        };
    },
};
```

Register it in `registry.ts`, replacing the placeholder.

- [ ] **Step 4: Write the service test**

```ts
// src/core/campaign/server/services/__tests__/create-campaign-service.test.ts
import { describe, expect, it, vi } from "vitest";
```

Mock `requireCafeRole` to succeed for `owner` and fail otherwise, mock the repository's `insertCampaign` to return `{ id: "camp-1" }`, and mock `enqueueJob`. Assert three behaviors: a non-owner is rejected; a valid input inserts the row and enqueues exactly one `campaign_create` job with `idempotencyKey === "campaign_create:camp-1"`; and a café with a null `chainCafeId` is rejected before anything is inserted.

- [ ] **Step 5: Write the service**

`createCampaignService` validates the role with `requireCafeRole(userId, cafeId, ["owner"])`, parses input through `createCampaignSchema`, rejects a café whose `chainCafeId` is null, then in one transaction inserts the campaign row and calls `enqueueJob` with kind `campaign_create`.

- [ ] **Step 6: Run tests**

Run: `pnpm check && pnpm typecheck && pnpm vitest run src/core/campaign src/core/chain/server/relayer`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/campaign/server/services/create-campaign-service.ts src/core/chain/server/relayer/handlers/ src/core/campaign/server/services/__tests__/
git commit -m "feat(campaign): create campaigns on chain via ops-signed job"
```

---

### Task 10: Fund campaign — approve then fund

`fundCampaign` moves mPEN from the signer, so the café owner's custodial wallet signs, not ops. ERC-20 requires `approve` first, and the drain sends one transaction per job, so this is a two-job chain.

**Files:**
- Create: `src/core/campaign/server/services/fund-campaign-service.ts`
- Create: `src/core/chain/server/relayer/handlers/campaign-fund.ts`
- Modify: `src/core/chain/server/relayer/handlers/registry.ts`
- Test: `src/core/chain/server/relayer/handlers/__tests__/campaign-fund.test.ts`

**Interfaces:**
- Produces: `fundCampaignService(userId, cafeId, campaignId, amount: bigint): AsyncAppResult<{ fundingId: string }>`; handlers `campaignFundApproveHandler`, `campaignFundHandler`; payload `{ campaignId: string; chainCampaignId: number; amount: string; walletIndex: number; fundingId: string }` (amount is a decimal string because JSON has no bigint)

- [ ] **Step 1: Write the failing test**

```ts
// src/core/chain/server/relayer/handlers/__tests__/campaign-fund.test.ts
import { describe, expect, it, vi } from "vitest";
import {
    campaignFundApproveHandler,
    campaignFundHandler,
} from "../campaign-fund";

const payload = {
    campaignId: "camp-1",
    chainCampaignId: 3,
    amount: "500000000",
    walletIndex: 12,
    fundingId: "fund-1",
};
const job = { id: "job-1", payload };
const ctx = {
    addresses: {
        campaignEscrow: "0x1111111111111111111111111111111111111111",
        mockPEN: "0x2222222222222222222222222222222222222222",
    },
} as never;

describe("campaign funding handlers", () => {
    it("signs with the cafe owner wallet, never with ops", () => {
        expect(campaignFundApproveHandler.signer(job as never)).toEqual({
            kind: "wallet",
            walletIndex: 12,
        });
        expect(campaignFundHandler.signer(job as never)).toEqual({
            kind: "wallet",
            walletIndex: 12,
        });
    });

    it("approves the escrow to spend exactly the funded amount", async () => {
        const call = await campaignFundApproveHandler.call(job as never, ctx);
        expect(call.address).toBe(ctx.addresses.mockPEN);
        expect(call.functionName).toBe("approve");
        expect(call.args).toEqual([ctx.addresses.campaignEscrow, 500000000n]);
    });

    it("funds the campaign by chain id", async () => {
        const call = await campaignFundHandler.call(job as never, ctx);
        expect(call.address).toBe(ctx.addresses.campaignEscrow);
        expect(call.functionName).toBe("fundCampaign");
        expect(call.args).toEqual([3n, 500000000n]);
    });

    it("chains the fund job when the approval confirms", async () => {
        const enqueued: unknown[] = [];
        const sideEffect = campaignFundApproveHandler.onConfirmed?.(
            job as never,
            { logs: [] } as never,
        );
        await sideEffect?.(
            { insert: () => ({ values: (v: unknown) => ({ onConflictDoNothing: () => ({ returning: () => { enqueued.push(v); return Promise.resolve([{}]); } }) }) }) } as never,
            job as never,
        );
        expect(enqueued).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/chain/server/relayer/handlers/__tests__/campaign-fund.test.ts`
Expected: FAIL — cannot find module `../campaign-fund`

- [ ] **Step 3: Write the handlers**

Both handlers share `payloadOf`. `campaignFundApproveHandler` calls `approve(escrow, amount)` on `addresses.mockPEN` and its `onConfirmed` returns a side effect that calls `enqueueJob` with kind `campaign_fund` and `idempotencyKey` `campaign_fund:${campaignId}:${fundingId}`. `campaignFundHandler` calls `fundCampaign(chainCampaignId, amount)`; `NotDraft` is a permanent failure (the campaign was published between the two jobs).

- [ ] **Step 4: Write the service**

`fundCampaignService` checks the `owner` role, loads the campaign and its projection, rejects if `chainCampaignId` is null (creation has not confirmed yet) or the projection status is not `draft`, generates `fundingId = crypto.randomUUID()`, and enqueues `campaign_fund_approve` with `idempotencyKey` `campaign_fund_approve:${campaignId}:${fundingId}`. The wallet index comes from the café owner's `user.walletIndex`; reject if it is null.

- [ ] **Step 5: Run tests**

Run: `pnpm check && pnpm typecheck && pnpm vitest run src/core/campaign src/core/chain/server/relayer`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/campaign/server/services/fund-campaign-service.ts src/core/chain/server/relayer/handlers/campaign-fund.ts src/core/chain/server/relayer/handlers/registry.ts src/core/chain/server/relayer/handlers/__tests__/campaign-fund.test.ts
git commit -m "feat(campaign): fund campaigns with the cafe owner wallet"
```

---

### Task 11: Publish campaign

**Files:**
- Create: `src/core/campaign/server/services/publish-campaign-service.ts`
- Create: `src/core/campaign/server/services/get-campaign-funding-service.ts`
- Create: `src/core/chain/server/relayer/handlers/campaign-publish.ts`
- Modify: `src/core/chain/server/relayer/handlers/registry.ts`
- Test: `src/core/campaign/server/services/__tests__/publish-campaign-service.test.ts`

**Interfaces:**
- Produces: `publishCampaignService(userId, cafeId, campaignId): AsyncAppResult<{ queued: true }>`; `getCampaignFundingService(userId, cafeId, campaignId): AsyncAppResult<{ required: bigint; funded: bigint; missing: bigint; lifecycle: CampaignLifecycle; canPublish: boolean }>`; `campaignPublishHandler`

- [ ] **Step 1: Write the failing test**

Assert four behaviors of `publishCampaignService` with mocked repository and `enqueueJob`:
1. A campaign whose projection budget is below `requiredBudget` is rejected with an `unprocessableEntity` error and enqueues nothing.
2. A campaign whose budget covers the requirement enqueues exactly one `campaign_publish` job.
3. A campaign already `published` is rejected.
4. Publishing twice enqueues once, because `enqueueJob` returns `null` on the duplicate key and the service maps that to success.

```ts
    it("does not enqueue when the chain budget is short", async () => {
        findCampaignWithProjection.mockResolvedValue({
            campaign: { id: "camp-1", cafeId: "cafe-1", voucherPayout: 50n, maxVouchers: 10, chainCampaignId: 3 },
            projection: { status: "draft", budget: 499n },
        });
        const result = await publishCampaignService("u1", "cafe-1", "camp-1");
        expect(result.ok).toBe(false);
        expect(enqueueJob).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/campaign/server/services/__tests__/publish-campaign-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the handler and services**

`campaignPublishHandler` signs with ops and calls `publishCampaign(chainCampaignId, voucherPayout, maxVouchers, expiry)` where `expiry` is `BigInt(Math.floor(windowEnd.getTime() / 1000))`. Its `preflight` re-reads `campaigns(chainCampaignId)` on chain and returns a failure when `budget < voucherPayout * maxVouchers`, so a stale projection never produces a doomed transaction.

`publishCampaignService` gates on `canPublish` from Task 8 before enqueueing.

`getCampaignFundingService` returns the numbers the screen needs, all derived from the projection.

- [ ] **Step 4: Run tests**

Run: `pnpm check && pnpm typecheck && pnpm vitest run src/core/campaign`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/campaign/server/services/ src/core/chain/server/relayer/handlers/campaign-publish.ts src/core/chain/server/relayer/handlers/registry.ts
git commit -m "feat(campaign): publish campaigns once the escrow covers every voucher"
```

---

### Task 12: Unlock — qualification enqueues, projection creates the voucher

**Files:**
- Modify: `src/core/punch/server/repository/campaigns.ts:12-29` (`findActiveCampaignForCafe`), `:101-137` (`unlockCampaignVoucher` → enqueue)
- Modify: `src/core/punch/server/repository/chain-purchase-effects.ts:66-108`
- Create: `src/core/chain/server/relayer/handlers/voucher-unlock.ts`
- Modify: `src/core/chain/server/relayer/handlers/registry.ts`
- Test: `src/core/punch/server/repository/__tests__/chain-purchase-effects.integration.test.ts` (extend), `src/core/chain/server/relayer/handlers/__tests__/voucher-unlock.test.ts`

**Interfaces:**
- Consumes: `enqueueJob`; `projectionCampaign`
- Produces: `enqueueCampaignUnlock(tx, input: { chainCampaignId: number; userAddress: string; effectId: string }): Promise<void>`; `voucherUnlockHandler`; `findActiveCampaignForCafe` now returns only campaigns published on chain, inside their window, with `unlockedCount < maxVouchers`

- [ ] **Step 1: Write the failing tests**

In `voucher-unlock.test.ts`, assert:
1. `signer` is `{ kind: "relayer" }` — the relayer is the `campaignOperator`.
2. `call` targets `unlockVoucher(chainCampaignId, userAddress)`.
3. `preflight` returns a failure when the on-chain campaign reports `unlockedCount >= maxVouchers`, when `block.timestamp > expiry`, or when the escrow is paused.
4. `idempotentCodes` contains `voucher_already_unlocked`.
5. `onFailed` writes the failure reason onto the effect row.

```ts
    it("refuses to submit when the cap is already reached", async () => {
        const ctx = {
            addresses: { campaignEscrow: "0x11" },
            pub: {
                readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
                    functionName === "paused"
                        ? false
                        : {
                              unlockedCount: 10n,
                              maxVouchers: 10n,
                              expiry: 9_999_999_999n,
                              status: 2,
                          },
                ),
            },
        };
        const failure = await voucherUnlockHandler.preflight?.(
            { payload: { chainCampaignId: 3, userAddress: "0xabc", effectId: "e1" } } as never,
            ctx as never,
        );
        expect(failure?.code).toBe("max_vouchers_reached");
    });
```

In the effects integration test, assert that a qualifying purchase now creates **no** `consumer_voucher` row and **one** pending `relayer_job` of kind `voucher_unlock`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify pnpm vitest run src/core/punch/server/repository src/core/chain/server/relayer/handlers`
Expected: FAIL — a voucher row is still created, handler module missing

- [ ] **Step 3: Extend the revert vocabulary**

In `parse-revert.ts`, add `abis.campaignEscrow` to `errorAbis` and these entries to `errorNames`, with matching additions to the `RevertCode` union:

```ts
    NotDraft: "not_draft",
    NotPublished: "not_published",
    CampaignNotFound: "campaign_not_found",
    CampaignExpired: "campaign_expired",
    MaxVouchersReached: "max_vouchers_reached",
    InsufficientBudget: "insufficient_budget",
    InsufficientFreeBalance: "insufficient_free_balance",
    ExpiryInPast: "expiry_in_past",
    ZeroAmount: "zero_amount",
    CafeNotOperational: "cafe_not_operational",
    VoucherNotUnlocked: "voucher_not_unlocked",
    VoucherAlreadyUnlocked: "voucher_already_unlocked",
    VoucherAlreadyRedeemed: "voucher_already_redeemed",
    NotCampaignOperator: "not_campaign_operator",
    OwnableUnauthorizedAccount: "not_owner",
    EnforcedPause: "paused",
```

Add every code except `paused`, `voucher_already_unlocked` and `voucher_already_redeemed` to the relayer's `PERMANENT_CODES`. `paused` stays transient so it retries; the two `already_*` codes are handled per-handler as idempotent successes.

- [ ] **Step 4: Rewire the qualification path**

In `campaigns.ts`, replace `unlockCampaignVoucher` with `enqueueCampaignUnlock`, which calls `enqueueJob` with kind `voucher_unlock` and `idempotencyKey` `voucher_unlock:${chainCampaignId}:${userAddress}`. Change `findActiveCampaignForCafe` to inner-join `projectionCampaign` on `campaign.chainCampaignId` and require `status = 'published'` and `unlockedCount < maxVouchers`.

In `chain-purchase-effects.ts`, the campaign branch now records the effect and calls `enqueueCampaignUnlock` with the effect id. Delete the `createdVoucherId` update — the projection sets it. Leave the crawl branch untouched.

- [ ] **Step 5: Write the handler**

`voucherUnlockHandler` signs with the relayer, preflights `campaigns(id)` and `paused()`, calls `unlockVoucher(chainCampaignId, userAddress)`, treats `voucher_already_unlocked` as success, and on permanent failure returns a side effect writing a user-readable string into `chain_purchase_effect.failureReason` — `"campaña agotada"` for `max_vouchers_reached`, `"campaña vencida"` for `campaign_expired`, and `null` for everything else, since the UI must not expose internal chain diagnostics.

- [ ] **Step 6: Run tests**

Run: `pnpm check && pnpm typecheck && PUNCH_RUN_INTEGRATION=1 DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/punch/server/repository/ src/core/chain/server/relayer/
git commit -m "feat(campaign): unlock vouchers on chain instead of in Postgres"
```

---

### Task 13: Redeem — real chain adapter

**Files:**
- Create: `src/core/consumption/server/campaign-escrow-chain.ts`
- Modify: `src/core/consumption/server/services/decide-voucher-redemption-service.ts:55` (chain selection)
- Create: `src/core/chain/server/relayer/handlers/voucher-redeem.ts`
- Modify: `src/core/chain/server/relayer/handlers/registry.ts`
- Test: `src/core/consumption/server/services/__tests__/decide-voucher-redemption-service.test.ts` (extend)

**Interfaces:**
- Produces: `CampaignEscrowChain` implementing `submitVoucherRedemption` from `ConsumerChainPort`; `voucherRedeemHandler`

- [ ] **Step 1: Write the failing test**

Assert that approving a voucher redemption enqueues one `voucher_redeem` job with `idempotencyKey === "voucher_redeem:<requestId>"` and returns status `pending`, and that the voucher row is **not** marked `redeemed` by the service.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/consumption/server/services/__tests__/decide-voucher-redemption-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the adapter and handler**

`CampaignEscrowChain.submitVoucherRedemption` loads the redemption request, resolves the voucher's `chainCampaignId` and the consumer's wallet address, enqueues `voucher_redeem`, and returns `{ transactionId, status: "pending" }`.

`voucherRedeemHandler` signs with the relayer, calls `redeemVoucher(chainCampaignId, userAddress)`, and treats `voucher_already_redeemed` as success.

In `decide-voucher-redemption-service.ts`, replace the hardcoded `new PostgresMockConsumerChain()` with a selector honoring `env.CONSUMER_CHAIN_MODE`: `"local"` yields `CampaignEscrowChain`, anything else keeps the mock. Do not edit `PostgresMockConsumerChain` itself — the parallel PUNCH-redemption session owns that file.

- [ ] **Step 4: Run tests**

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/consumption/server/ src/core/chain/server/relayer/handlers/voucher-redeem.ts src/core/chain/server/relayer/handlers/registry.ts
git commit -m "feat(campaign): redeem vouchers against the escrow"
```

---

### Task 14: Café campaigns screen

**Files:**
- Create: `src/app/(app)/(workspace)/cafe/[cafeId]/campaigns/page.tsx`
- Create: `src/core/campaign/server/api/routes/create-campaign.route.ts`, `fund-campaign.route.ts`, `publish-campaign.route.ts`, `list-cafe-campaigns.route.ts`
- Create: `src/core/campaign/client/hooks.ts`
- Modify: the workspace router that mounts café routes (find it with `rg "list-cafe-purchases.route" src/`)
- Test: `src/app/(app)/(workspace)/cafe/[cafeId]/campaigns/__tests__/campaigns-page.test.tsx`

**Interfaces:**
- Consumes: the four services from Tasks 9-11
- Produces: `GET/POST /cafe/:cafeId/campaigns`, `POST /cafe/:cafeId/campaigns/:campaignId/fund`, `POST /cafe/:cafeId/campaigns/:campaignId/publish`

- [ ] **Step 1: Read an existing screen to copy its patterns**

Run: `cat "src/app/(app)/(workspace)/cafe/[cafeId]/redemptions/page.tsx"` and its test. Match its data-fetching, form and error conventions exactly rather than introducing new ones.

- [ ] **Step 2: Write the failing test**

Assert four rendered behaviors:
1. The form shows the required budget as `voucherPayout × maxVouchers` and updates when either input changes.
2. A campaign in lifecycle `creating` renders a pending state and no publish button.
3. A `draft` campaign whose funded amount is below the requirement shows the missing amount and a disabled publish button.
4. A `draft` campaign fully funded shows an enabled publish button.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run "src/app/(app)/(workspace)/cafe/[cafeId]/campaigns"`
Expected: FAIL — page does not exist

- [ ] **Step 4: Write the routes, hooks and page**

Every displayed amount comes from `getCampaignFundingService`, i.e. from the projection. The page must never compute funded state from local form input.

- [ ] **Step 5: Run tests**

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/(workspace)/cafe/[cafeId]/campaigns" src/core/campaign/
git commit -m "feat(campaign): add cafe campaign screen"
```

---

### Task 15: Bootstrap the demo campaign on chain

**Files:**
- Modify: `scripts/seed.ts:182-193` (stop inserting the loose campaign)
- Modify: `src/core/chain/server/bootstrap-local/service.ts`, `repository.ts`
- Modify: `scripts/bootstrap-local.ts`
- Test: `src/core/chain/server/bootstrap-local/__tests__/service.test.ts` (extend)

**Interfaces:**
- Consumes: `deriveOpsAccount`; `abis.campaignEscrow`; `abis.mockPEN`
- Produces: `bootstrapDemoCampaign(input: { repository; chain; cafeSlug: string }): Promise<void>` — idempotent, creating, funding and publishing the demo campaign only when the café has no linked campaign

- [ ] **Step 1: Write the failing test**

Assert that running the bootstrap twice mints, creates, funds and publishes exactly once, and that the second run makes no chain writes.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/chain/server/bootstrap-local/`
Expected: FAIL

- [ ] **Step 3: Implement**

`scripts/seed.ts` drops the `campaign` insert and its `demoCampaignValues` usage; the demo campaign now originates from bootstrap. Keep `demoCampaignValues` exported and reuse it from bootstrap so the demo copy stays in one place.

Bootstrap mints the demo budget to the café owner with `MockPEN.mint` (ops-signed; MockPEN's owner is the deployer, so mint before ownership handoff or use the deployer key here), then runs create → fund → publish, and writes `chainCampaignId` onto the campaign row.

- [ ] **Step 4: Verify against a fresh stack**

```bash
dropdb --if-exists punch_plan_verify && createdb punch_plan_verify
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify
pnpm db:migrate && pnpm db:seed
# in another shell: anvil
pnpm chain:deploy && pnpm chain:bootstrap-local
```

Expected: bootstrap completes and the demo campaign row has a non-null `chain_campaign_id`. Confirm with:

```bash
psql "$DATABASE_URL" -c "select id, chain_campaign_id, voucher_payout, max_vouchers from campaign;"
psql "$DATABASE_URL" -c "select * from projection_campaign;"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/ src/core/chain/server/bootstrap-local/
git commit -m "feat(campaign): bootstrap the demo campaign on chain"
```

---

### Task 16: Live campaign journey

**Files:**
- Create: `src/core/chain/server/__tests__/campaign-journey.live.test.ts`

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: Read the existing live test to copy its harness**

Run: `cat src/core/chain/server/__tests__/purchase-journey.live.test.ts`

Reuse its gating (`PUNCH_RUN_INTEGRATION=1` and `PUNCH_RUN_LIVE_CHAIN=1`), its anvil setup and its indexer/relayer drive loop verbatim.

- [ ] **Step 2: Write the journey test**

The test drives the full path and asserts the money moved:

```ts
    it("pays the cafe owner exactly one voucherPayout on redemption", async () => {
        const before = await pub.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [cafeOwnerAddress],
        });

        await approveVoucherRedemption();
        await drainRelayerAndIndexer();

        const after = await pub.readContract({
            address: addresses.mockPEN,
            abi: abis.mockPEN,
            functionName: "balanceOf",
            args: [cafeOwnerAddress],
        });
        const [projected] = await db
            .select()
            .from(projectionCampaign)
            .where(eq(projectionCampaign.chainCampaignId, chainCampaignId));

        expect(after - before).toBe(voucherPayout);
        expect(projected.redeemedCount).toBe(1);
        expect(projected.budget).toBe(initialBudget - voucherPayout);
    });
```

Add three more cases in the same file:
1. Create → fund → publish leaves `projection_campaign.status = 'published'` with the exact payout and cap.
2. A qualifying purchase produces a `consumer_voucher` row **only after** the relayer and indexer both run — assert the row is absent immediately after the purchase confirms and present after the drain.
3. A second purchase by the same consumer at the same café unlocks no second voucher (the escrow reverts `VoucherAlreadyUnlocked`, which the handler converges to success, and `unlockedCount` stays at 1).

- [ ] **Step 3: Run the journey against a fresh stack**

```bash
dropdb --if-exists punch_plan_verify && createdb punch_plan_verify
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/punch_plan_verify
pnpm db:migrate && pnpm db:seed
# fresh anvil in another shell
pnpm chain:deploy && pnpm chain:bootstrap-local
PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1 pnpm vitest run src/core/chain/server/__tests__/campaign-journey.live.test.ts
```

Expected: PASS

- [ ] **Step 4: Run everything**

```bash
pnpm check && pnpm typecheck && pnpm test
PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1 pnpm test
```

Expected: all pass. Confirm `git status` shows `src/core/chain/addresses.local.json` as modified but **not** staged.

- [ ] **Step 5: Commit**

```bash
git add src/core/chain/server/__tests__/campaign-journey.live.test.ts
git commit -m "test(campaign): cover the on-chain campaign journey end to end"
```
