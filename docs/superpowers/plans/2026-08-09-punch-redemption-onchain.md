# On-chain PUNCH Redemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approving a PUNCH redemption burns 12 PUNCH and pays S/3.60 to the host café via `PunchVault.redeem` on the real local chain, replacing the disabled Postgres-mock path.

**Architecture:** Generalize the existing purchase relayer (`relayer_job` gains a `kind`), dispatch `PunchVault.redeem` from the relayer wallet (also set as the vault's `redeemer`), index `RewardRedeemed` into balance/payout projections with an idempotent ledger, and extend the drift-rebuild to replay redemptions. Chain decides the redemption; Postgres queues, authorizes UX, and projects.

**Tech Stack:** TypeScript, Next.js 16, Elysia + Eden, Drizzle ORM (PostgreSQL), viem, Vitest, Foundry/Anvil, Solidity (contracts already complete).

**Spec:** `docs/superpowers/specs/2026-08-09-punch-redemption-onchain-design.md` — read for rationale; this plan is self-contained for execution.

## Global Constraints

- Chain is the economic authority; Postgres never decides a redemption (master spec §02). The DB-side balance pre-check is UX guard only.
- `PunchVault.redeem` has NO on-chain idempotency: a duplicate send double-burns. Every send path must be gated by the DB dedupe described in Task 3.
- Local mnemonic is TEST-ONLY, gated on chain ID `31337`. Never expose mnemonics, private keys, wallet indices, or full signatures in logs or client responses.
- Never commit `src/core/chain/addresses.local.json`. Never touch `.env`.
- Verification always on a fresh DB (the `.env` database has a broken migration lineage): `createdb` → `pnpm db:migrate` → `pnpm db:seed` → fresh anvil 31337 → `pnpm chain:deploy` → `pnpm chain:bootstrap-local`. Gated tests: `PUNCH_RUN_INTEGRATION=1` (+ `PUNCH_RUN_LIVE_CHAIN=1` for live-chain tests).
- Payout constants come from the contract: `PUNCHES_PER_REWARD = 12`, `HOST_PAYOUT = 3_600_000` mPEN units (S/3.60 = 360 centimos).
- Voucher redemption keeps using `PostgresMockConsumerChain` — out of scope; do not touch its path.
- Postgres runs in docker container `punch-pg` (`docker start punch-pg` if `connect ETIMEDOUT 127.0.0.1:5432`).
- Biome formatting; run `pnpm check` before each commit (never pipe it into `tail`/`head` — pipes mask the exit code).

---

### Task 1: Schema + migration (relayer_job kind, redemption_request states, payout projection)

**Files:**
- Modify: `src/server/drizzle/schemas/purchase-schema.ts` (relayerJob)
- Modify: `src/server/drizzle/schemas/consumption-schema.ts` (redemptionRequestStatus, redemptionRequest)
- Modify: `src/server/drizzle/schemas/chain-schema.ts` (new projectionCafePayout)
- Create: `drizzle/00XX_*.sql` via `pnpm db:generate` (next number after current max)
- Test: `src/server/drizzle/__tests__/redemption-schema.integration.test.ts`

**Interfaces:**
- Produces: `relayerJob.kind` (`"consumption" | "punch_redemption"`), `relayerJob.redemptionRequestId` (nullable, unique), `relayerJob.orderId` now nullable; `redemptionRequest.status` gains `"confirmed" | "failed"`, new column `redemptionRequest.failureReason`; new table `projectionCafePayout { cafeId (PK, text, FK cafe.id), totalCentimos (integer, default 0), redemptionCount (integer, default 0), updatedAt }`; partial unique `redemption_request_active_punch_uq` on `(consumer_user_id)` where `kind = 'punch_reward' AND status IN ('pending','approved')`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/drizzle/__tests__/redemption-schema.integration.test.ts
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";

const run = process.env.PUNCH_RUN_INTEGRATION === "1" ? describe : describe.skip;

run("redemption schema", () => {
    it("relayer_job accepts a punch_redemption row without order_id", async () => {
        const rows = await db.execute(sql`
            SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_name = 'relayer_job' AND column_name IN ('order_id', 'kind', 'redemption_request_id')
        `);
        const byName = Object.fromEntries(
            (rows as unknown as { column_name: string; is_nullable: string }[]).map(
                (r) => [r.column_name, r.is_nullable],
            ),
        );
        expect(byName.order_id).toBe("YES");
        expect(byName.kind).toBe("NO");
        expect(byName.redemption_request_id).toBe("YES");
    });

    it("redemption_request_status enum includes confirmed and failed", async () => {
        const rows = await db.execute(sql`
            SELECT enumlabel FROM pg_enum
            JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
            WHERE pg_type.typname = 'redemption_request_status'
        `);
        const labels = (rows as unknown as { enumlabel: string }[]).map((r) => r.enumlabel);
        expect(labels).toContain("confirmed");
        expect(labels).toContain("failed");
    });

    it("projection_cafe_payout table exists", async () => {
        const rows = await db.execute(sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'projection_cafe_payout'
        `);
        const names = (rows as unknown as { column_name: string }[]).map((r) => r.column_name);
        expect(names).toEqual(
            expect.arrayContaining(["cafe_id", "total_centimos", "redemption_count"]),
        );
    });

    it("only one active punch_reward request per consumer", async () => {
        const rows = await db.execute(sql`
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'redemption_request' AND indexname = 'redemption_request_active_punch_uq'
        `);
        expect((rows as unknown as unknown[]).length).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails** — `PUNCH_RUN_INTEGRATION=1 pnpm vitest run src/server/drizzle/__tests__/redemption-schema.integration.test.ts` on a fresh migrated DB. Expected: FAIL (columns/enum values/table missing).

- [ ] **Step 3: Edit schemas.**

In `purchase-schema.ts`, add the enum and modify `relayerJob` (import `redemptionRequest` from consumption-schema is a circular-import risk — reference by column name string instead, matching how FKs can be declared, OR keep the FK and verify no cycle; consumption-schema already imports `purchaseOrder` from purchase-schema, so the FK **must** be declared from a raw reference to avoid the cycle):

```ts
export const relayerJobKind = pgEnum("relayer_job_kind", [
    "consumption",
    "punch_redemption",
]);

export const relayerJob = pgTable(
    "relayer_job",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        kind: relayerJobKind("kind").default("consumption").notNull(),
        orderId: text("order_id")
            .unique()
            .references(() => purchaseOrder.id, { onDelete: "restrict" }),
        // punch_redemption jobs: FK to redemption_request added in raw SQL
        // (declaring it here would create a schema-module import cycle).
        redemptionRequestId: text("redemption_request_id").unique(),
        // consumption: { proof, cafeSignature, userSignature }
        // punch_redemption: { userWallet, chainCafeId, chainProductId }
        payload: jsonb("payload").notNull(),
        attempts: integer("attempts").default(0).notNull(),
        nextRetryAt: timestamp("next_retry_at").defaultNow().notNull(),
        status: relayerJobStatus("status").default("pending").notNull(),
        txHash: text("tx_hash"),
        lastError: text("last_error"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (t) => [
        index("relayer_job_status_retry_idx").on(t.status, t.nextRetryAt),
        check(
            "relayer_job_target_check",
            sql`(${t.kind} = 'consumption' AND ${t.orderId} IS NOT NULL AND ${t.redemptionRequestId} IS NULL) OR (${t.kind} = 'punch_redemption' AND ${t.redemptionRequestId} IS NOT NULL AND ${t.orderId} IS NULL)`,
        ),
    ],
);
```

In `consumption-schema.ts`:

```ts
export const redemptionRequestStatus = pgEnum("redemption_request_status", [
    "pending",
    "approved",
    "rejected",
    "confirmed",
    "failed",
]);
```

Add to `redemptionRequest` columns: `failureReason: text("failure_reason"),` and to its index array:

```ts
uniqueIndex("redemption_request_active_punch_uq")
    .on(table.consumerUserId)
    .where(
        sql`${table.kind} = 'punch_reward' AND ${table.status} IN ('pending', 'approved')`,
    ),
```

In `chain-schema.ts` (follow the style of `projectionCafeCredit` in that file):

```ts
export const projectionCafePayout = pgTable("projection_cafe_payout", {
    cafeId: text("cafe_id")
        .primaryKey()
        .references(() => cafe.id),
    totalCentimos: integer("total_centimos").default(0).notNull(),
    redemptionCount: integer("redemption_count").default(0).notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .$onUpdate(() => new Date())
        .notNull(),
});
```

(Import `cafe` from cafe-schema and `integer` if missing.)

- [ ] **Step 4: Generate migration** — `pnpm db:generate`. Inspect the generated SQL: `ALTER TYPE ... ADD VALUE` statements for the enum, `ALTER TABLE relayer_job` alterations, new table, partial unique index, CHECK constraint. Append (hand-edit the generated migration) the FK that the schema module cannot declare:

```sql
ALTER TABLE "relayer_job" ADD CONSTRAINT "relayer_job_redemption_request_id_fk" FOREIGN KEY ("redemption_request_id") REFERENCES "redemption_request"("id") ON DELETE restrict;
```

Note: Postgres cannot run `ALTER TYPE ... ADD VALUE` inside a transaction block with drizzle-kit's default; if migration fails on that, split enum additions into their own statement-breakpoint blocks (drizzle emits `--> statement-breakpoint` markers; verify they surround the enum ALTERs).

- [ ] **Step 5: Run migration on fresh DB, run test to verify it passes** — recreate the fresh DB, `pnpm db:migrate`, then re-run Step 2 command. Expected: PASS.

- [ ] **Step 6: Run existing suites** — `pnpm vitest run` (unit) plus `pnpm check` and `pnpm typecheck`. The nullable `orderId` will break type assumptions in `purchase-repository.ts` (`job.orderId` now `string | null`): fix call sites with explicit null guards that throw `new Error("consumption job missing orderId")` — Task 3 replaces these with real branching; here they only preserve behavior for `kind = 'consumption'`.

- [ ] **Step 7: Commit** — `git add -A src/server/drizzle drizzle src/core/purchase && git commit -m "feat(db): generalize relayer_job and add redemption projection schema"`

---

### Task 2: Approve enqueues a redemption job (mock dies for PUNCH)

**Files:**
- Modify: `src/core/consumption/server/repository/redemption-requests.ts`
- Modify: `src/core/consumption/server/services/decide-punch-redemption-service.ts`
- Modify: `src/core/consumption/server/services/request-punch-redemption-service.ts` (map unique violation → conflict)
- Test: `src/core/consumption/server/services/__tests__/decide-punch-redemption-service.test.ts` (rewrite), `src/core/consumption/server/repository/__tests__/redemption-requests.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 schema (`relayerJob.kind`, `redemptionRequestId`; `redemptionRequest.status` extended).
- Produces: `approveRedemptionAndEnqueueJob(requestId: string, deciderUserId: string, payload: { userWallet: string; chainCafeId: number; chainProductId: number }): Promise<RedemptionRequestRow>` in `redemption-requests.ts` — one DB transaction: request `pending → approved` (sets `decidedByUserId`) + insert `relayer_job { kind: 'punch_redemption', redemptionRequestId, payload }`. Idempotent: if request already `approved`/`confirmed` returns current row without a second job (unique on `redemption_request_id` backstops at DB level). Throws `RedemptionRequestRepositoryError("REQUEST_NOT_FOUND" | "INVALID_TRANSITION")` otherwise.

- [ ] **Step 1: Write failing unit tests for the decide service.** Rewrite the existing test file. The service's new dependency surface (follow the `deps: Partial<Deps>` injection pattern used by `confirm-quote-service.ts`):

```ts
// decide-punch-redemption-service.ts new dep type (for reference in tests)
type DecidePunchDeps = {
    requireCafeRole: typeof requireCafeRole;
    findRequest: typeof findRedemptionRequestById;
    decideRequest: typeof decideRedemptionRequest;      // still used for 'rejected'
    approveAndEnqueue: typeof approveRedemptionAndEnqueueJob;
    findUserWallet: typeof findUserWallet;               // consumer wallet
    findCafeChainMapping: (cafeId: string) => Promise<{ chainCafeId: number | null }>;
    findProductChainMapping: (productId: string) => Promise<{ chainProductId: number | null }>;
};
```

Tests (mock all deps):

```ts
it("approving enqueues a punch_redemption job with resolved chain payload", async () => {
    // arrange mocks: membership ok, request pending punch_reward,
    // wallet 0xabc..., chainCafeId 3, chainProductId 7
    // act: decision "approved"
    // assert: approveAndEnqueue called with (requestId, deciderUserId,
    //   { userWallet: "0xabc...", chainCafeId: 3, chainProductId: 7 })
    // assert: result ok, status "approved"
});
it("rejecting never enqueues", async () => { /* decision "rejected" → decideRequest called, approveAndEnqueue NOT called */ });
it("missing chain mapping returns 422 and does not enqueue", async () => { /* chainCafeId null → unprocessableEntity targets ["chainMapping"] */ });
it("missing consumer wallet returns 422", async () => { /* wallet null → unprocessableEntity targets ["wallet"] */ });
it("re-approving an approved request is idempotent", async () => { /* approveAndEnqueue resolves current approved row; result ok; no error */ });
it("PostgresMockConsumerChain is no longer imported", async () => {
    const src = await readFile("src/core/consumption/server/services/decide-punch-redemption-service.ts", "utf8");
    expect(src).not.toContain("PostgresMockConsumerChain");
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/core/consumption/server/services/__tests__/decide-punch-redemption-service.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

`redemption-requests.ts` — add:

```ts
export async function approveRedemptionAndEnqueueJob(
    requestId: string,
    deciderUserId: string,
    payload: { userWallet: string; chainCafeId: number; chainProductId: number },
) {
    return db.transaction(async (tx) => {
        const [existing] = await tx
            .select()
            .from(redemptionRequest)
            .where(eq(redemptionRequest.id, requestId))
            .for("update");
        if (!existing) throw new RedemptionRequestRepositoryError("REQUEST_NOT_FOUND");
        if (existing.status === "approved" || existing.status === "confirmed") {
            return existing;
        }
        if (existing.status !== "pending") {
            throw new RedemptionRequestRepositoryError("INVALID_TRANSITION");
        }
        const [updated] = await tx
            .update(redemptionRequest)
            .set({ status: "approved", decidedByUserId: deciderUserId })
            .where(and(eq(redemptionRequest.id, requestId), eq(redemptionRequest.status, "pending")))
            .returning();
        if (!updated) throw new RedemptionRequestRepositoryError("INVALID_TRANSITION");
        await tx
            .insert(relayerJob)
            .values({
                kind: "punch_redemption",
                redemptionRequestId: requestId,
                payload,
            })
            .onConflictDoNothing({ target: relayerJob.redemptionRequestId });
        return updated;
    });
}
```

(`INVALID_TRANSITION` may need adding to `RedemptionRequestRepositoryError`'s code union; check the class in the same file and extend.)

`decide-punch-redemption-service.ts` — replace the `PostgresMockConsumerChain` paths: on `approved` decision resolve consumer wallet (`findUserWallet(existing.consumerUserId)` — needs `walletAddress`; 422 `["wallet"]` if missing), café mapping (`cafe.chainCafeId` via a small select — mirror how `confirm-quote-service` fails 422 `["chainMapping"]`), product mapping (`cafeProduct.chainProductId`), then `approveAndEnqueue`. On `rejected` keep the existing `decideRedemptionRequest` path minus the chain submission. Return `ok(toRedemptionRequest(row))` in both cases — the `ChainSubmission` return variant disappears from this service.

`request-punch-redemption-service.ts` — wrap `createRedemptionRequest` in try/catch; a Postgres unique violation (error `code === "23505"` on `redemption_request_active_punch_uq`, surface however Drizzle wraps it — inspect `cause`) maps to `err(AppErrors.conflict({ targets: ["request"] }))`.

- [ ] **Step 4: Run tests to verify pass** — same command. Expected: PASS. Also `pnpm vitest run src/core/consumption` for collateral.

- [ ] **Step 5: Integration test for the repository fn** (`redemption-requests.integration.test.ts`, gated `PUNCH_RUN_INTEGRATION=1`): seed user+cafe+product+request; call `approveRedemptionAndEnqueueJob` twice; assert exactly one `relayer_job` row (kind `punch_redemption`, payload round-trips), request `approved`; assert double `createRedemptionRequest` for same consumer throws unique violation. Run gated; expect PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(redemption): approval enqueues on-chain redemption job, mock removed for PUNCH"`

---

### Task 3: Relayer dispatches punch_redemption with anti-double-burn guard

**Files:**
- Modify: `src/core/chain/server/relayer/parse-revert.ts`
- Modify: `src/core/chain/server/relayer/relayer.ts`
- Modify: `src/core/purchase/server/repository/purchase-repository.ts` (`markJobConfirmed`, `markJobFailed` branch by kind)
- Test: `src/core/chain/server/relayer/__tests__/relayer-redemption.test.ts`, extend `src/core/chain/server/relayer/__tests__/parse-revert.test.ts` (or create)

**Interfaces:**
- Consumes: Task 1 schema; Task 2 payload shape `{ userWallet, chainCafeId, chainProductId }`.
- Produces: relayer sends `PunchVault.redeem(userWallet, BigInt(chainCafeId), BigInt(chainProductId))` for `kind === "punch_redemption"`; `RevertCode` union gains `"insufficient_punch" | "host_not_operational" | "reward_not_eligible" | "not_redeemer"`; `RelayerDeps` gains `hasRedemptionLedger: (requestId: string) => Promise<boolean>` (defaults to a `consumer_transaction` lookup by `idempotencyKey = "chain_redemption:" + requestId`).

- [ ] **Step 1: Write failing tests.**

parse-revert: encode each new `PunchVault` error with viem `encodeErrorResult` against `abis.punchVault` and assert codes:

```ts
it.each([
    ["InsufficientPunch", ["0x" + "11".repeat(20), 3n], "insufficient_punch"],
    ["HostNotOperational", [5n], "host_not_operational"],
    ["ProductNotEligibleReward", [5n, 9n], "reward_not_eligible"],
    ["NotRedeemer", ["0x" + "22".repeat(20)], "not_redeemer"],
])("decodes %s", (errorName, args, code) => {
    const data = encodeErrorResult({ abi: abis.punchVault as Abi, errorName, args });
    expect(parseRevert({ data }).code).toBe(code);
});
```

relayer (mock deps, follow the existing relayer test file's dep-stubbing style):

```ts
it("sends PunchVault.redeem for punch_redemption jobs", async () => {
    // job: kind punch_redemption, payload { userWallet, chainCafeId: 3, chainProductId: 7 }
    // assert wallet.writeContract called with address addresses.punchVault,
    //   functionName "redeem", args [userWallet, 3n, 7n]
});
it("skips send and confirms when redemption ledger already exists", async () => {
    // hasRedemptionLedger resolves true → writeContract NOT called, markJobConfirmed called
});
it("permanent vault revert marks job failed with parsed reason", async () => {
    // waitForTransactionReceipt → reverted; replay simulate throws InsufficientPunch
    // assert markJobFailed(id, "insufficient_punch", "insufficient_punch")
});
it("not_redeemer retries instead of failing permanently", async () => {
    // NotRedeemer is bootstrap misconfiguration: assert markJobRetry called, not markJobFailed
});
it("recoverStuckJobs verifies existing receipt before any resend for redemption jobs", async () => {
    // job submitted with txHash, receipt success → markJobConfirmed, writeContract never called
});
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL (unknown codes, no dispatch).

- [ ] **Step 3: Implement.**

`parse-revert.ts`: add `abis.punchVault` to `errorAbis`; extend `RevertCode` union and `errorNames`:

```ts
InsufficientPunch: "insufficient_punch",
HostNotOperational: "host_not_operational",
ProductNotEligibleReward: "reward_not_eligible",
NotRedeemer: "not_redeemer",
```

`relayer.ts`:
- `PERMANENT_CODES` gains `"insufficient_punch"`, `"host_not_operational"`, `"reward_not_eligible"` — NOT `"not_redeemer"` (transient: bootstrap incomplete; the generic retry/3-attempts path handles it, with a `getLogger(["chain", "relayer"]).error("punch vault redeemer not configured")` when parsed).
- New `parseRedemptionSubmission(job)` validating payload shape (address regex for `userWallet`, integer cafeId/productId) → `{ user: Address, cafeId: bigint, productId: bigint }`.
- `submitJob` branches on `job.kind`:

```ts
if (job.kind === "punch_redemption") {
    return submitRedemptionJob(deps, job);
}
```

- `submitRedemptionJob`: (1) if `!job.redemptionRequestId` → `markJobFailed(id, "invalid payload", "unknown")`; (2) **guard**: `if (await deps.hasRedemptionLedger(job.redemptionRequestId)) { await deps.markJobConfirmed(job.id); return; }`; (3) parse payload, `writeContract` `PunchVault.redeem`, then the same `markJobSubmitted` → `waitForTransactionReceipt` → success/`handleFailure` shape as the consumption path. For the reverted-receipt replay, add a redemption variant of `replaySubmissionError` simulating `redeem` at the receipt block (widen the `pub.simulateContract` dep type to a generic `(args: object) => Promise<unknown>` — it is already only used to harvest the revert error).
- `recoverStuckJobs`: branch by kind before `parseSubmission` (which is consumption-specific); for redemption jobs with a `txHash`, fetch the receipt — success → confirm; reverted → replay-simulate for the reason; missing → `markJobPending`. Never resend without checking the ledger guard first.
- `defaultDeps` gains:

```ts
hasRedemptionLedger: async (requestId: string) => {
    const [row] = await db
        .select({ id: consumerTransaction.id })
        .from(consumerTransaction)
        .where(eq(consumerTransaction.idempotencyKey, `chain_redemption:${requestId}`));
    return !!row;
},
```

`purchase-repository.ts` — `markJobConfirmed` and `markJobFailed` currently assume `orderId`. Branch: when the updated job row has `redemptionRequestId` (select `kind`/`redemptionRequestId` in the `.returning(...)`):
- `markJobConfirmed`: job → `confirmed`; do NOT touch the request (the indexer confirms it from the chain event).
- `markJobFailed`: job → `failed` and:

```ts
await tx
    .update(redemptionRequest)
    .set({ status: "failed", failureReason })
    .where(and(
        eq(redemptionRequest.id, job.redemptionRequestId),
        eq(redemptionRequest.status, "approved"),
    ));
```

(mirrors the quote-failure propagation from commit `9a519f6`; import `redemptionRequest` — purchase-repository importing consumption-schema is safe, no cycle at the repository layer).

- [ ] **Step 4: Run tests to verify pass** — relayer + parse-revert + full `pnpm vitest run src/core/chain src/core/purchase`. Expected: PASS, no regressions in existing relayer tests.

- [ ] **Step 5: Commit** — `git commit -m "feat(relayer): dispatch PunchVault.redeem with double-burn guard"`

---

### Task 4: Indexer projects RewardRedeemed (balance −12, request confirmed, café payout)

**Files:**
- Create: `src/core/chain/server/indexer/redemption-projection.ts`
- Modify: `src/core/chain/server/indexer/apply-event.ts`
- Modify: `src/core/chain/server/indexer/indexer.ts` (sources)
- Test: `src/core/chain/server/indexer/__tests__/redemption-projection.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 `projectionCafePayout`; `abis.punchVault` event `RewardRedeemed(address user, uint256 hostCafeId, uint256 productId)`.
- Produces: `applyRewardRedeemedProjection(tx: IndexerTransaction, input: { userAddress: string; chainCafeId: number; txHash: string; logIndex: number; blockNumber: bigint }): Promise<void>` — exported for the rebuild test to exercise replay.

- [ ] **Step 1: Write failing integration test** (gated `PUNCH_RUN_INTEGRATION=1`, synthetic events — no live chain; follow the style of the existing indexer integration tests that call `applyEvent` directly):

```ts
it("RewardRedeemed decrements balance, confirms the approved request, records payout", async () => {
    // seed: user (walletAddress 0xAAA...), cafe (chainCafeId 3), product,
    //   redemption_request status 'approved', projection_punch_balance 12 for 0xaaa
    // act: applyEvent(tx, { eventName: "RewardRedeemed", args: { user, hostCafeId: 3n, productId: 7n }, ... })
    // assert: projection_punch_balance for address = 0
    // assert: request status 'confirmed'
    // assert: projection_cafe_payout { totalCentimos: 360, redemptionCount: 1 }
    // assert: consumer_transaction row idempotencyKey 'chain_redemption:<requestId>',
    //   operation 'punch_redemption', status 'confirmed', transactionHash/logIndex set
});
it("replaying the same event is a no-op beyond the ledger gate", async () => {
    // apply the same event twice in fresh transactions with the SAME txHash/logIndex
    // balance decremented ONCE only when the ledger gate blocks the second pass
    // assert payout still 360 / count 1, balance unchanged after second apply
});
it("event with no matching approved request only adjusts balance", async () => {
    // no redemption_request seeded → balance -12 applied, no ledger row, no payout
});
```

IMPORTANT design note for the implementer (this is what makes replay exact): the **balance decrement must sit behind the same ledger gate** as the payout when a request matches, and behind a `projectionConsumption`-style dedup when it does not. Simplest correct structure: always insert a dedup row first (reuse `consumerTransaction` when a request matches — key `chain_redemption:<requestId>`; when none matches, still decrement unconditionally because the cursor prevents double-processing and the rebuild deletes balances wholesale before replay — mirror how `addPunch` relies on the cursor). The second test then asserts the with-request path via the ledger gate; cursor-idempotency for the no-request path needs no test beyond existing indexer cursor tests.

- [ ] **Step 2: Run to verify failure.** Expected: FAIL (`unsupported event RewardRedeemed`).

- [ ] **Step 3: Implement.**

`redemption-projection.ts`:

```ts
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import {
    projectionCafePayout,
    projectionPunchBalance,
} from "@/server/drizzle/schemas/chain-schema";
import {
    consumerTransaction,
    redemptionRequest,
} from "@/server/drizzle/schemas/consumption-schema";
import type { IndexerTransaction } from "./apply-event";

export const PUNCHES_PER_REWARD = 12n;
export const HOST_PAYOUT_CENTIMOS = 360;

export async function applyRewardRedeemedProjection(
    tx: IndexerTransaction,
    input: {
        userAddress: string;
        chainCafeId: number;
        txHash: string;
        logIndex: number;
        blockNumber: bigint;
    },
): Promise<void> {
    await tx
        .update(projectionPunchBalance)
        .set({
            balance: sql`${projectionPunchBalance.balance} - ${PUNCHES_PER_REWARD}`,
            lastBlock: sql`GREATEST(${projectionPunchBalance.lastBlock}, ${input.blockNumber})`,
        })
        .where(eq(projectionPunchBalance.userAddress, input.userAddress));

    const [match] = await tx
        .select({
            requestId: redemptionRequest.id,
            consumerUserId: redemptionRequest.consumerUserId,
            cafeId: redemptionRequest.cafeId,
        })
        .from(redemptionRequest)
        .innerJoin(user, eq(user.id, redemptionRequest.consumerUserId))
        .innerJoin(cafe, eq(cafe.id, redemptionRequest.cafeId))
        .where(
            and(
                eq(redemptionRequest.kind, "punch_reward"),
                eq(redemptionRequest.status, "approved"),
                eq(cafe.chainCafeId, input.chainCafeId),
                sql`lower(${user.walletAddress}) = ${input.userAddress}`,
            ),
        )
        .orderBy(redemptionRequest.createdAt)
        .limit(1);
    if (!match) return;

    const inserted = await tx
        .insert(consumerTransaction)
        .values({
            id: `chain_redemption:${match.requestId}`,
            operation: "punch_redemption",
            consumerUserId: match.consumerUserId,
            cafeId: match.cafeId,
            redemptionRequestId: match.requestId,
            chainTxId: input.txHash,
            status: "confirmed",
            idempotencyKey: `chain_redemption:${match.requestId}`,
            transactionHash: input.txHash,
            chainBlockNumber: input.blockNumber,
            logIndex: input.logIndex,
        })
        .onConflictDoNothing({ target: consumerTransaction.idempotencyKey })
        .returning({ id: consumerTransaction.id });
    if (inserted.length === 0) return;

    await tx
        .update(redemptionRequest)
        .set({ status: "confirmed" })
        .where(eq(redemptionRequest.id, match.requestId));
    await tx
        .insert(projectionCafePayout)
        .values({
            cafeId: match.cafeId,
            totalCentimos: HOST_PAYOUT_CENTIMOS,
            redemptionCount: 1,
        })
        .onConflictDoUpdate({
            target: projectionCafePayout.cafeId,
            set: {
                totalCentimos: sql`${projectionCafePayout.totalCentimos} + ${HOST_PAYOUT_CENTIMOS}`,
                redemptionCount: sql`${projectionCafePayout.redemptionCount} + 1`,
            },
        });
}
```

(Check `consumerTransactionStatus` enum contains `"confirmed"` — the existing emission ledger writes status; copy whatever status value `purchase-projection.ts:57` uses for its ledger rows.)

`apply-event.ts`: add `"RewardRedeemed"` to the `eventName` union; in `applyEvent`'s switch add:

```ts
case "RewardRedeemed": {
    return applyRewardRedeemedProjection(tx, {
        userAddress: address(event.args.user),
        chainCafeId: cafeId(event.args.hostCafeId),
        txHash: event.transactionHash,
        logIndex: logIndex(event),
        blockNumber: block(event),
    });
}
```

`indexer.ts`: `source("punchVault", abis.punchVault, ["PunchIssued", "RewardRedeemed"])`.

- [ ] **Step 4: Run tests to verify pass** — gated integration + full unit suite. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(indexer): project RewardRedeemed into balance, request, and cafe payout"`

---

### Task 5: Rebuild replays redemptions

**Files:**
- Modify: `src/core/chain/server/reconciler/purchase-projection-rebuild.ts`
- Test: extend `src/core/chain/server/reconciler/__tests__/purchase-projection-rebuild.integration.test.ts`

**Interfaces:**
- Consumes: Task 4 ledger convention `chain_redemption:<requestId>`, `projectionCafePayout`.
- Produces: `clearChainDerivedPurchaseProjections` additionally deletes `chain_redemption:%` ledger rows, wipes `projection_cafe_payout`, resets `redemptionRequest` `confirmed → approved`.

- [ ] **Step 1: Write failing integration test** (gated; extend existing file's `seedMinimalCase` helper or add a sibling seed):

```ts
it("clear resets redemption state so replay reconfirms exactly", async () => {
    // seed: confirmed redemption (request 'confirmed', ledger row, payout 360/1,
    //   balance already decremented in projection)
    // act: clearChainDerivedPurchaseProjections(db)
    // assert: request back to 'approved'; ledger row gone; payout row gone;
    //   projection_punch_balance wiped (already asserted by existing tests)
    // act: applyRewardRedeemedProjection replay with original event coords
    // assert: request 'confirmed' again, payout 360/1 again, single ledger row
});
it("failed redemption requests survive the clear untouched", async () => {
    // seed request status 'failed' with failureReason
    // act: clear; assert still 'failed' with reason intact
});
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL (request stays `confirmed`, payout persists).

- [ ] **Step 3: Implement** — append inside the existing transaction in `clearChainDerivedPurchaseProjections` (after the emission-ledger delete, before the cursor reset):

```ts
await tx
    .delete(consumerTransaction)
    .where(
        and(
            eq(consumerTransaction.operation, "punch_redemption"),
            like(consumerTransaction.idempotencyKey, "chain_redemption:%"),
        ),
    );
await tx
    .update(redemptionRequest)
    .set({ status: "approved" })
    .where(eq(redemptionRequest.status, "confirmed"));
await tx.delete(projectionCafePayout).where(sql`true`);
```

(Import `redemptionRequest` and `projectionCafePayout`.)

- [ ] **Step 4: Run to verify pass** — gated rebuild suite (all existing rebuild tests must stay green). Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(reconciler): rebuild replays on-chain redemptions"`

---

### Task 6: Deploy wiring — setRedeemer, and live end-to-end test

**Files:**
- Modify: `scripts/dev-chain.ts` (`deployContracts`)
- Test: `src/core/chain/server/__tests__/redemption-journey.live.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: after `pnpm chain:deploy`, `PunchVault.redeemer() === relayer wallet address`.

- [ ] **Step 1: Write the failing live test** (gated `PUNCH_RUN_LIVE_CHAIN=1`; follow the setup style of `purchase-journey.live.test.ts` — fresh DB + fresh anvil + deploy + bootstrap are external prerequisites, the test asserts against the running stack):

```ts
it("redeemer is wired to the relayer wallet", async () => {
    const pub = createChainPublicClient();
    const redeemer = await pub.readContract({
        address: getAddresses().punchVault,
        abi: abis.punchVault,
        functionName: "redeemer",
    });
    const relayer = deriveUserAccount(env.RELAYER_WALLET_INDEX).address;
    expect((redeemer as string).toLowerCase()).toBe(relayer.toLowerCase());
});

it("approving a redemption burns 12 and pays the host on chain", async () => {
    // arrange: consumer with >= 12 PUNCH on chain (bootstrap seeds 11; drive one
    //   real purchase through the existing purchase pipeline like
    //   purchase-journey.live.test.ts does, or issue via ConsumptionLog test path)
    // record: host owner wallet mPEN balance before, vault balanceOf(consumer) before
    // act: requestPunchRedemptionService + approveRedemptionAndEnqueueJob
    //   (call services directly), then runRelayerOnce() and runIndexerOnce()
    // assert: vault balanceOf(consumer) === before - 12n
    // assert: pen.balanceOf(hostOwner) === before + 3_600_000n
    // assert: redemption_request status 'confirmed'
    // assert: projection_cafe_payout totalCentimos 360
});

it("double-approving does not double-burn", async () => {
    // act: approveRedemptionAndEnqueueJob again + runRelayerOnce twice
    // assert: vault balance unchanged from previous test's end state
    // assert: single relayer_job row for the request
});
```

- [ ] **Step 2: Run to verify failure** — full clean sequence (fresh DB, anvil, deploy, bootstrap), then `PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1 pnpm vitest run src/core/chain/server/__tests__/redemption-journey.live.test.ts`. Expected: first test FAILS (`redeemer` = zero address), second fails with `NotRedeemer` retry exhaustion.

- [ ] **Step 3: Implement** — in `deployContracts` (scripts/dev-chain.ts), after the `punchVault.setConsumptionLog` write:

```ts
const relayerIndex = Number(process.env.RELAYER_WALLET_INDEX ?? 0);
const redeemerAddress = mnemonicToAccount(appMnemonic, {
    addressIndex: relayerIndex,
}).address;
await waitForWrite(
    pub,
    await wallet.writeContract({
        address: punchVault,
        abi: vaultAbi,
        functionName: "setRedeemer",
        args: [redeemerAddress],
    }),
    "set redeemer",
);
```

- [ ] **Step 4: Re-run the full clean sequence + live test.** Expected: PASS 3/3.

- [ ] **Step 5: Revert-check (controller will verify):** with Task 3's ledger guard commented out, the double-approve test must fail (double burn). Restore.

- [ ] **Step 6: Commit** — `git commit -m "feat(chain): wire vault redeemer to relayer wallet with live redemption journey"`

#### Task 6 addendum (added mid-execution — two gaps the live run exposed)

The first live run failed before reaching the vault, exposing two gaps no earlier task covered. Both are prerequisites for redemption to work at all, so they belong to this task.

**6A — Reward products are never registered on chain.** `bootstrapApprovedSeedCafes` (`src/core/chain/server/bootstrap-local/service.ts`) filters products to `type === "emission"`, so reward products get no `chainProductId` and are never marked eligible in `CafeRegistry`. `PunchVault.redeem` calls `registry.isEligible(hostCafeId, productId, ProductKind.Reward)`, so every redemption would revert with `ProductNotEligibleReward`.

`ProductKind` is `{ Emission = 0, Reward = 1 }` (`packages/contracts/src/interfaces/ICafeRegistry.sol:12-15`). `scripts/dev-chain.ts`'s `seedCafe` currently hardcodes kind `0` in its `setEligibleProduct` loop.

Fix: make the bootstrap chain port kind-aware. Replace the flat `eligibleProductIds: bigint[]` in `BootstrapChain`'s `seedCafe`/`verifyCafe`/`LiveCafe` with a shape that carries the kind per product (e.g. `products: { productId: bigint; kind: 0 | 1 }[]`), register reward products with kind `1`, and persist their `chainProductId` alongside the emission ones. Keep emission product numbering unchanged (ids `1..n` in creation order) and number rewards after them, so existing mappings and the historical-consumption seeding keep working.

**6B — The redemption request service reads the wrong balance table.** `requestPunchRedemptionService` calls `getBalance` from `src/core/punch/server/repository/balance.ts`, which reads `punch_balance_projection` — the mock-era, per-`userId` table that the chain pipeline never writes. The chain-backed balance lives in `projection_punch_balance`, keyed by wallet address, and `getConsumerBalance` (`src/core/purchase/server/services/get-balance-service.ts`) already selects the right source for the active chain mode. So a consumer with 12 real PUNCH on chain is refused with 422 "Necesitas 12 PUNCH para canjear."

Fix: `requestPunchRedemptionService` uses `getConsumerBalance(userId)` and applies `canRedeem` to its `punchBalance`. Treat a null balance (stale projection) as not-yet-redeemable rather than as zero, and keep the check a UX guard — the chain still decides.

---

### Task 7: Consumer + café UI

**Files:**
- Modify: `src/app/(app)/(consumer)/redeem/[productId]/page.tsx` (drop the local-mode gate for PUNCH)
- Modify: `src/app/(app)/(workspace)/cafe/[cafeId]/redemptions/page.tsx` (status polling, payout per confirmed row, failure reason)
- Modify: café panel page (locate: `src/app/(app)/(workspace)/cafe/[cafeId]/page.tsx` or its dashboard component) — payout summary card
- Create: `src/core/consumption/server/services/get-cafe-payouts-service.ts` + route wiring in the consumption/cafe Elysia router (locate the router that already serves redemptions list)
- Test: existing `redeem-page.test.tsx` (update), `redemptions-page.test.tsx` (extend), `get-cafe-payouts-service.test.ts`

**Interfaces:**
- Consumes: `projectionCafePayout`; `redemptionRequest.status` extended values; `pen.balanceOf` view call via `createChainPublicClient()` + `abis.mockPEN` (confirm the ABI key name in `abis.ts`).
- Produces: `getCafePayoutsService(userId: string, cafeId: string): AsyncAppResult<{ totalCentimos: number; redemptionCount: number; ownerMpenCentimos: number | null }>` — membership-gated (`requireCafeRole` owner|barista); `ownerMpenCentimos` null when the chain read fails (UI shows "—", never blocks the panel).

- [ ] **Step 1: Failing tests.** (a) `redeem-page.test.tsx`: change the "disables PUNCH redemption in local chain mode" test to assert the button is ENABLED in local mode (this is the behavior change — the old test dies with the gate). (b) `redemptions-page.test.tsx`: a `confirmed` request row shows "S/3.60"; a `failed` row shows its `failureReason`; an `approved` row shows a processing state. (c) service test: mocks repo + chain read; membership rejected → 403; chain read throws → `ownerMpenCentimos: null`, still ok.

- [ ] **Step 2: Run all three to verify failure.**

- [ ] **Step 3: Implement.** Service reads `projectionCafePayout` by cafeId (zeros when absent), resolves owner wallet (cafe owner membership → user.walletAddress), `pub.readContract({ address: addresses.mockPEN, abi: abis.mockPEN, functionName: "balanceOf", args: [ownerWallet] })` in try/catch → centimos (`Number(balance / 10_000n)`). Route: follow the exact registration pattern of the existing redemptions-list endpoint in the same router file. UI: redemptions page already refetches its list (verify; if not, add a `setInterval`-based refetch of 3s while any row is `approved` — mirror how the purchase confirm page polls); payout card on the panel renders `S/{(totalCentimos/100).toFixed(2)}` + count + owner mPEN balance (or "—").

- [ ] **Step 4: Run tests to verify pass** + `pnpm vitest run src/app` + `pnpm typecheck && pnpm check`.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): enable on-chain PUNCH redemption and cafe payout visibility"`

---

### Task 8: Browser acceptance + full verification

**Files:** none new (verification task; fixes go where the bugs are).

- [ ] **Step 1: Full clean sequence** — fresh DB + `pnpm demo:local` (remember: `DATABASE_URL=... pnpm demo:local` overrides the `.env` DB because node `--env-file` never overrides already-set shell vars).
- [ ] **Step 2: Browser journey (Playwright MCP):** login `demo-consumer@punch.pe` → dashboard 11/12 → buy one coffee via QR flow at a café (11→12) → open redeem page for a reward product → request → login café owner → approve in redemptions page → see processing → confirmed + S/3.60 → consumer dashboard 0/12 → café panel shows payout total and mPEN balance.
- [ ] **Step 3: Drift check:** `pnpm reconcile-local` (or the existing reconcile script) after redemption — no drift reported; then force a rebuild (the path the reconciler takes on drift) and verify the journey state survives: request stays `confirmed`, balance 0/12, payout intact.
- [ ] **Step 4: Full suites:** `pnpm vitest run`, gated integration + live, `pnpm typecheck`, `pnpm check`, `pnpm build`. All green.
- [ ] **Step 5: Commit any fixes discovered** (each with its own failing test first).

---

## Self-review notes (already applied)

- Balance decrement idempotency intentionally mirrors `addPunch` (cursor-guarded, wiped-and-replayed by rebuild) — the ledger gates only request/payout effects. Consistent with existing emission design.
- `markJobConfirmed` for redemption does not confirm the request — only the indexer does, from the chain event. UI's "confirmado" therefore always reflects indexed chain state.
- The circular-import constraint (purchase-schema ↔ consumption-schema) is handled by declaring the `redemption_request_id` FK in raw SQL (Task 1 Step 4).
- `not_redeemer` deliberately non-permanent: it signals missing bootstrap wiring, not a bad request.
