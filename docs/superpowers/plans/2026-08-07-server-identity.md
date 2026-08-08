# Server Identity (3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user gets an invisible custodial EVM account derived from a master mnemonic, users can hold café memberships (`cafe_member`), and judges can enter the app via demo login buttons backed by an idempotent seed script.

**Architecture:** Better Auth stays the identity system. A `databaseHooks.user.create.after` hook assigns each new user a unique `wallet_index` (Postgres sequence) and stores the derived address; the private key is never persisted — it is re-derived on demand from `WALLET_MASTER_MNEMONIC` via viem HD derivation. Authorization helpers (`requireCafeRole`, `requireOps`) follow the existing `AppResult` service pattern. Seed script creates demo ops/owners/consumer accounts through Better Auth's server API so hooks fire.

**Tech Stack:** Better Auth 1.6, viem 2.x (`viem/accounts`), Drizzle + node-postgres, Elysia, Vitest, t3-env.

**Spec:** `docs/superpowers/specs/2026-08-07-server-identity-design.md` (master spec §05, §18, §20, §22).

## Global Constraints

- Custodial MVP per master spec §20: server signs on behalf of users; this is declared, not hidden. Private keys are NEVER written to Postgres, logs, or API responses.
- User-facing flows never mention wallet/gas/tx (master spec §05); the only user-visible artifact is nothing — address is internal.
- Derivation path: standard `m/44'/60'/0'/0/{index}` via `mnemonicToAccount(mnemonic, { addressIndex })`.
- All new server files that touch secrets import `"server-only"`.
- Vitest tests live in `src/**/__tests__/*.test.ts`; alias `@` → `src`.
- Run `pnpm check:fix && pnpm typecheck && pnpm test` before each commit.
- Branch from `main` in a worktree (superpowers:using-git-worktrees), branch name `feat/server-identity`.
- Migrations: `pnpm db:generate` produces SQL under `drizzle/`; commit generated SQL with the schema change. (Running `db:migrate` needs a reachable `DATABASE_URL`; if unavailable in the worktree, note it in the commit body and continue — SQL review is the deliverable.)

---

### Task 1: Env vars for wallet + demo mode

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: existing `createEnv` setup.
- Produces: `env.WALLET_MASTER_MNEMONIC: string` (server), `env.NEXT_PUBLIC_DEMO_MODE: boolean`, `env.NEXT_PUBLIC_DEMO_PASSWORD: string | undefined` — used by Tasks 3, 6.

- [ ] **Step 1: Extend env schema**

Modify `src/config/env.ts` to:

```ts
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
    server: {
        DATABASE_URL: z.url(),
        BETTER_AUTH_SECRET: z.string().min(32),
        // 12/24-word BIP-39 phrase; custodial signer root (spec 3a §20).
        WALLET_MASTER_MNEMONIC: z
            .string()
            .refine((v) => [12, 15, 18, 21, 24].includes(v.trim().split(/\s+/).length), {
                message: "WALLET_MASTER_MNEMONIC must be a BIP-39 phrase (12–24 words)",
            }),
    },
    client: {
        NEXT_PUBLIC_APP_URL: z.url(),
        NEXT_PUBLIC_DEMO_MODE: z
            .string()
            .optional()
            .transform((v) => v === "true"),
        NEXT_PUBLIC_DEMO_PASSWORD: z.string().min(8).optional(),
    },
    runtimeEnv: {
        DATABASE_URL: process.env.DATABASE_URL,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        WALLET_MASTER_MNEMONIC: process.env.WALLET_MASTER_MNEMONIC,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
        NEXT_PUBLIC_DEMO_PASSWORD: process.env.NEXT_PUBLIC_DEMO_PASSWORD,
    },
    emptyStringAsUndefined: true,
});
```

- [ ] **Step 2: Document in .env.example**

Append to `.env.example`:

```bash
# Custodial wallet root — BIP-39 mnemonic. Dev default is the well-known test phrase.
# NEVER use this phrase with real funds.
WALLET_MASTER_MNEMONIC="test test test test test test test test test test test junk"

# Demo mode: shows one-click demo login buttons on the auth page.
NEXT_PUBLIC_DEMO_MODE="true"
NEXT_PUBLIC_DEMO_PASSWORD="punch-demo-2026"
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS (env additions compile; nothing consumes them yet).

- [ ] **Step 4: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "feat(identity): add wallet mnemonic and demo mode env vars"
```

---

### Task 2: Schema — wallet columns, sequence, cafe_member

**Files:**
- Modify: `src/server/drizzle/schemas/auth-schema.ts`
- Create: `src/server/drizzle/schemas/cafe-schema.ts`
- Modify: `src/server/drizzle/schemas/index.ts`
- Create: generated SQL under `drizzle/` (via `pnpm db:generate`)

**Interfaces:**
- Consumes: existing `user` table.
- Produces: `user.walletIndex: integer | null`, `user.walletAddress: text | null`, `user.isOps: boolean`; `walletIndexSeq` Postgres sequence `wallet_index_seq`; `cafeMember` table + `CafeMemberRow` type + `cafeMemberRole` enum (`"owner" | "barista"`). Used by Tasks 3–6 and by sub-project 3b.

- [ ] **Step 1: Add wallet columns + sequence to auth schema**

In `src/server/drizzle/schemas/auth-schema.ts`, add `integer` and `pgSequence` to the drizzle-orm/pg-core import, then extend `user`:

```ts
export const walletIndexSeq = pgSequence("wallet_index_seq", {
    startWith: 0,
    minValue: 0,
});

export const user = pgTable("user", {
    // ...existing columns unchanged...
    walletIndex: integer("wallet_index").unique(),
    walletAddress: text("wallet_address").unique(),
    isOps: boolean("is_ops").default(false).notNull(),
});
```

(Keep every existing column exactly as is; only append the three new ones.)

- [ ] **Step 2: Create cafe_member table**

Create `src/server/drizzle/schemas/cafe-schema.ts`:

```ts
import {
    index,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const cafeMemberRole = pgEnum("cafe_member_role", ["owner", "barista"]);

/**
 * Links a user to a café panel role. `cafeId` has no FK yet — the `cafe`
 * table arrives in sub-project 3b, whose migration adds the reference.
 */
export const cafeMember = pgTable(
    "cafe_member",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        cafeId: text("cafe_id").notNull(),
        role: cafeMemberRole("role").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("cafe_member_user_cafe_uq").on(table.userId, table.cafeId),
        index("cafe_member_cafe_id_idx").on(table.cafeId),
    ],
);

export type CafeMemberRow = typeof cafeMember.$inferSelect;
export type CafeMemberRole = (typeof cafeMemberRole.enumValues)[number];
```

- [ ] **Step 3: Export from schema index**

In `src/server/drizzle/schemas/index.ts` add:

```ts
export * from "./cafe-schema";
```

- [ ] **Step 4: Generate migration**

Run: `pnpm db:generate`
Expected: new SQL file under `drizzle/` containing `ALTER TABLE "user" ADD COLUMN "wallet_index" ...`, `CREATE SEQUENCE "wallet_index_seq" ...`, `CREATE TABLE "cafe_member" ...`. Inspect the SQL; it must not drop or rewrite existing tables.

- [ ] **Step 5: Typecheck + test + commit**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

```bash
git add src/server/drizzle drizzle
git commit -m "feat(identity): wallet columns, wallet_index sequence, cafe_member table"
```

---

### Task 3: Pure HD derivation module

**Files:**
- Create: `src/core/chain/server/wallet/derive.ts`
- Test: `src/core/chain/server/wallet/__tests__/derive.test.ts`

**Interfaces:**
- Consumes: `env.WALLET_MASTER_MNEMONIC` (Task 1).
- Produces: `deriveAccount(mnemonic: string, addressIndex: number): HDAccount` (pure) and `deriveUserAccount(addressIndex: number): HDAccount` (env-bound). `HDAccount` is viem's — has `.address` and `.signTypedData`. Used by Tasks 4 and by future relayer/emission work.

- [ ] **Step 1: Write the failing test**

`src/core/chain/server/wallet/__tests__/derive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveAccount } from "../derive";

// Well-known BIP-39 test phrase (hardhat/foundry default) with published
// derived addresses — deterministic fixture, never used with real funds.
const TEST_MNEMONIC =
    "test test test test test test test test test test test junk";

describe("deriveAccount", () => {
    it("derives the canonical address for index 0", () => {
        const account = deriveAccount(TEST_MNEMONIC, 0);
        expect(account.address).toBe(
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        );
    });

    it("derives the canonical address for index 1", () => {
        const account = deriveAccount(TEST_MNEMONIC, 1);
        expect(account.address).toBe(
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        );
    });

    it("is deterministic: same index → same address", () => {
        expect(deriveAccount(TEST_MNEMONIC, 7).address).toBe(
            deriveAccount(TEST_MNEMONIC, 7).address,
        );
    });

    it("different indexes → different addresses", () => {
        expect(deriveAccount(TEST_MNEMONIC, 2).address).not.toBe(
            deriveAccount(TEST_MNEMONIC, 3).address,
        );
    });

    it("can sign EIP-712 typed data", async () => {
        const account = deriveAccount(TEST_MNEMONIC, 0);
        const signature = await account.signTypedData({
            domain: { name: "PunchTest", version: "1", chainId: 421614 },
            types: { Ping: [{ name: "nonce", type: "uint256" }] },
            primaryType: "Ping",
            message: { nonce: 1n },
        });
        expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/core/chain/server/wallet`
Expected: FAIL — cannot resolve `../derive`.

- [ ] **Step 3: Implement derive module**

`src/core/chain/server/wallet/derive.ts`:

```ts
import "server-only";
import { type HDAccount, mnemonicToAccount } from "viem/accounts";
import { env } from "@/config/env";

/** Pure HD derivation at m/44'/60'/0'/0/{addressIndex}. Test seam. */
export function deriveAccount(
    mnemonic: string,
    addressIndex: number,
): HDAccount {
    if (!Number.isInteger(addressIndex) || addressIndex < 0) {
        throw new Error(`Invalid wallet index: ${addressIndex}`);
    }
    return mnemonicToAccount(mnemonic, { addressIndex });
}

/** Derives the custodial account for a user's assigned wallet index. */
export function deriveUserAccount(addressIndex: number): HDAccount {
    return deriveAccount(env.WALLET_MASTER_MNEMONIC, addressIndex);
}
```

Note: `"server-only"` resolves to `src/test/server-only-stub.ts` under Vitest (existing setup) — check `vitest.config.ts` alias; if the stub alias is missing, add it the same way existing server tests handle it. The test imports only `deriveAccount`, and `env` access happens lazily at call time in `deriveUserAccount`, so the test does not need env vars.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/core/chain/server/wallet`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/chain/server/wallet
git commit -m "feat(identity): custodial HD account derivation"
```

---

### Task 4: assignWallet service + Better Auth signup hook

**Files:**
- Create: `src/core/chain/server/wallet/repository.ts`
- Create: `src/core/chain/server/wallet/assign-wallet.ts`
- Test: `src/core/chain/server/wallet/__tests__/assign-wallet.test.ts`
- Modify: `src/server/auth/auth.ts`

**Interfaces:**
- Consumes: Task 2 schema, Task 3 `deriveUserAccount`.
- Produces: `assignWallet(userId: string): Promise<{ walletIndex: number; address: string }>` — idempotent, race-safe. Wired into Better Auth so every new user gets a wallet. `user.isOps` exposed on session via `additionalFields`.

- [ ] **Step 1: Write repository (thin DB access, mocked in tests)**

`src/core/chain/server/wallet/repository.ts`:

```ts
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";

export type UserWallet = { walletIndex: number | null; walletAddress: string | null };

export async function findUserWallet(userId: string): Promise<UserWallet | null> {
    const [row] = await db
        .select({ walletIndex: user.walletIndex, walletAddress: user.walletAddress })
        .from(user)
        .where(eq(user.id, userId));
    return row ?? null;
}

export async function claimWalletIndex(): Promise<number> {
    const result = await db.execute<{ idx: number }>(
        sql`select nextval('wallet_index_seq')::int as idx`,
    );
    return result.rows[0].idx;
}

/** Sets wallet fields only if still unassigned. Returns false on lost race. */
export async function setUserWallet(
    userId: string,
    walletIndex: number,
    walletAddress: string,
): Promise<boolean> {
    const updated = await db
        .update(user)
        .set({ walletIndex, walletAddress })
        .where(and(eq(user.id, userId), isNull(user.walletIndex)))
        .returning({ id: user.id });
    return updated.length > 0;
}
```

- [ ] **Step 2: Write the failing service test**

`src/core/chain/server/wallet/__tests__/assign-wallet.test.ts` (mirrors the project-services mocking style):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repository", () => ({
    findUserWallet: vi.fn(),
    claimWalletIndex: vi.fn(),
    setUserWallet: vi.fn(),
}));
vi.mock("../derive", () => ({
    deriveUserAccount: vi.fn(),
}));

import { assignWallet } from "../assign-wallet";
import { deriveUserAccount } from "../derive";
import { claimWalletIndex, findUserWallet, setUserWallet } from "../repository";

const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("assignWallet", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns existing wallet without touching the sequence", async () => {
        vi.mocked(findUserWallet).mockResolvedValue({
            walletIndex: 4,
            walletAddress: ADDR,
        });
        const r = await assignWallet("u1");
        expect(r).toEqual({ walletIndex: 4, address: ADDR });
        expect(claimWalletIndex).not.toHaveBeenCalled();
    });

    it("claims an index, derives, persists", async () => {
        vi.mocked(findUserWallet).mockResolvedValue({
            walletIndex: null,
            walletAddress: null,
        });
        vi.mocked(claimWalletIndex).mockResolvedValue(9);
        vi.mocked(deriveUserAccount).mockReturnValue({ address: ADDR } as never);
        vi.mocked(setUserWallet).mockResolvedValue(true);
        const r = await assignWallet("u1");
        expect(deriveUserAccount).toHaveBeenCalledWith(9);
        expect(setUserWallet).toHaveBeenCalledWith("u1", 9, ADDR);
        expect(r).toEqual({ walletIndex: 9, address: ADDR });
    });

    it("on lost race returns the winner's wallet", async () => {
        vi.mocked(findUserWallet)
            .mockResolvedValueOnce({ walletIndex: null, walletAddress: null })
            .mockResolvedValueOnce({ walletIndex: 2, walletAddress: ADDR });
        vi.mocked(claimWalletIndex).mockResolvedValue(9);
        vi.mocked(deriveUserAccount).mockReturnValue({
            address: "0x0000000000000000000000000000000000000001",
        } as never);
        vi.mocked(setUserWallet).mockResolvedValue(false);
        const r = await assignWallet("u1");
        expect(r).toEqual({ walletIndex: 2, address: ADDR });
    });

    it("throws when user does not exist", async () => {
        vi.mocked(findUserWallet).mockResolvedValue(null);
        await expect(assignWallet("ghost")).rejects.toThrow(/not found/);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- src/core/chain/server/wallet`
Expected: FAIL — cannot resolve `../assign-wallet`.

- [ ] **Step 4: Implement assignWallet**

`src/core/chain/server/wallet/assign-wallet.ts`:

```ts
import "server-only";
import { deriveUserAccount } from "./derive";
import { claimWalletIndex, findUserWallet, setUserWallet } from "./repository";

export type AssignedWallet = { walletIndex: number; address: string };

/**
 * Idempotent custodial wallet assignment. Race-safe: the UPDATE only lands
 * on a still-unassigned row; a lost race re-reads the winner's values.
 * Gaps in the sequence are fine — indexes only need uniqueness.
 */
export async function assignWallet(userId: string): Promise<AssignedWallet> {
    const existing = await findUserWallet(userId);
    if (!existing) throw new Error(`assignWallet: user ${userId} not found`);
    if (existing.walletIndex !== null && existing.walletAddress) {
        return {
            walletIndex: existing.walletIndex,
            address: existing.walletAddress,
        };
    }
    const walletIndex = await claimWalletIndex();
    const account = deriveUserAccount(walletIndex);
    const won = await setUserWallet(userId, walletIndex, account.address);
    if (!won) {
        const winner = await findUserWallet(userId);
        if (!winner || winner.walletIndex === null || !winner.walletAddress) {
            throw new Error(`assignWallet: lost race but no wallet on ${userId}`);
        }
        return { walletIndex: winner.walletIndex, address: winner.walletAddress };
    }
    return { walletIndex, address: account.address };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- src/core/chain/server/wallet`
Expected: PASS (derive + assign-wallet suites).

- [ ] **Step 6: Wire Better Auth hook + isOps field**

In `src/server/auth/auth.ts`, inside the `betterAuth({...})` config add:

```ts
    user: {
        additionalFields: {
            isOps: { type: "boolean", defaultValue: false, input: false },
        },
    },
    databaseHooks: {
        user: {
            create: {
                after: async (createdUser) => {
                    try {
                        await assignWallet(createdUser.id);
                    } catch (e) {
                        // Signup must not fail if wallet assignment hiccups;
                        // assignWallet is idempotent and re-runnable (seed/backfill).
                        logger.error("wallet assignment failed for {userId}: {error}", {
                            userId: createdUser.id,
                            error: e,
                        });
                    }
                },
            },
        },
    },
```

with import `import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";`.

- [ ] **Step 7: Full verification + commit**

Run: `pnpm check:fix && pnpm typecheck && pnpm test`
Expected: all PASS.

```bash
git add src/core/chain/server/wallet src/server/auth/auth.ts
git commit -m "feat(identity): assign custodial wallet on signup"
```

---

### Task 5: Membership authorization guards

**Files:**
- Create: `src/server/auth/membership/repository.ts`
- Create: `src/server/auth/membership/require-cafe-role.ts`
- Test: `src/server/auth/membership/__tests__/require-cafe-role.test.ts`

**Interfaces:**
- Consumes: `cafeMember` schema (Task 2), `AppErrors`/`AppResult` from `@/server/common/responses`.
- Produces:
  - `findMembership(userId: string, cafeId: string): Promise<CafeMemberRow | null>`
  - `requireCafeRole(userId: string, cafeId: string, roles: CafeMemberRole[]): AsyncAppResult<CafeMemberRow>` — 403 `FORBIDDEN` when no membership or wrong role.
  - `requireOps(user: { isOps?: boolean | null }): AppResult<true>` — 403 unless ops.
  Used by every 3b route.

- [ ] **Step 1: Write the failing test**

`src/server/auth/membership/__tests__/require-cafe-role.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repository", () => ({ findMembership: vi.fn() }));

import type { CafeMemberRow } from "@/server/drizzle/schemas/cafe-schema";
import { findMembership } from "../repository";
import { requireCafeRole, requireOps } from "../require-cafe-role";

const membership: CafeMemberRow = {
    id: "m1",
    userId: "u1",
    cafeId: "c1",
    role: "owner",
    createdAt: new Date(),
};

describe("requireCafeRole", () => {
    beforeEach(() => vi.clearAllMocks());

    it("allows a matching role", async () => {
        vi.mocked(findMembership).mockResolvedValue(membership);
        const r = await requireCafeRole("u1", "c1", ["owner"]);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.role).toBe("owner");
    });

    it("forbids when no membership", async () => {
        vi.mocked(findMembership).mockResolvedValue(null);
        const r = await requireCafeRole("u1", "c1", ["owner"]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    });

    it("forbids when role not in allowed set", async () => {
        vi.mocked(findMembership).mockResolvedValue({
            ...membership,
            role: "barista",
        });
        const r = await requireCafeRole("u1", "c1", ["owner"]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(403);
    });

    it("barista allowed when barista is in the set", async () => {
        vi.mocked(findMembership).mockResolvedValue({
            ...membership,
            role: "barista",
        });
        const r = await requireCafeRole("u1", "c1", ["owner", "barista"]);
        expect(r.ok).toBe(true);
    });
});

describe("requireOps", () => {
    it("allows ops user", () => {
        expect(requireOps({ isOps: true }).ok).toBe(true);
    });
    it("forbids non-ops and missing flag", () => {
        expect(requireOps({ isOps: false }).ok).toBe(false);
        expect(requireOps({}).ok).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/server/auth/membership`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement repository + guards**

`src/server/auth/membership/repository.ts`:

```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import {
    cafeMember,
    type CafeMemberRow,
} from "@/server/drizzle/schemas/cafe-schema";

export async function findMembership(
    userId: string,
    cafeId: string,
): Promise<CafeMemberRow | null> {
    const [row] = await db
        .select()
        .from(cafeMember)
        .where(and(eq(cafeMember.userId, userId), eq(cafeMember.cafeId, cafeId)));
    return row ?? null;
}
```

`src/server/auth/membership/require-cafe-role.ts`:

```ts
import "server-only";
import {
    AppErrors,
    type AppResult,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import type {
    CafeMemberRole,
    CafeMemberRow,
} from "@/server/drizzle/schemas/cafe-schema";
import { findMembership } from "./repository";

export async function requireCafeRole(
    userId: string,
    cafeId: string,
    roles: CafeMemberRole[],
): AsyncAppResult<CafeMemberRow> {
    const membership = await findMembership(userId, cafeId);
    if (!membership || !roles.includes(membership.role)) {
        return err(AppErrors.forbidden());
    }
    return ok(membership);
}

export function requireOps(user: { isOps?: boolean | null }): AppResult<true> {
    if (!user.isOps) return err(AppErrors.forbidden());
    return ok(true);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/server/auth/membership`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/membership
git commit -m "feat(identity): cafe membership and ops authorization guards"
```

---

### Task 6: Seed script + demo login buttons

**Files:**
- Create: `scripts/seed.ts`
- Modify: `package.json` (add `db:seed` script)
- Create: `src/frontend/components/auth/demo-login.tsx`
- Modify: `src/app/auth/[path]/page.tsx` (render `<DemoLogin />` alongside the existing auth card)

**Interfaces:**
- Consumes: Better Auth server API (`auth.api.signUpEmail`), Task 1 env, Task 4 hook (fires on signup), `authClient` from `@/frontend/auth/auth`.
- Produces: `pnpm db:seed` (idempotent); demo accounts `demo-ops@punch.pe` (isOps), `brujula@punch.pe`, `patio9@punch.pe`, `nube@punch.pe`, `esquinasur@punch.pe`, `demo-consumer@punch.pe`; `DEMO_ACCOUNTS` export reused by 3b seed extension.

- [ ] **Step 1: Write seed script**

`scripts/seed.ts`:

```ts
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";

export const DEMO_ACCOUNTS = [
    { email: "demo-ops@punch.pe", name: "Operaciones PUNCH", isOps: true },
    { email: "brujula@punch.pe", name: "Brújula Café", isOps: false },
    { email: "patio9@punch.pe", name: "Patio 9", isOps: false },
    { email: "nube@punch.pe", name: "Nube Tostada", isOps: false },
    { email: "esquinasur@punch.pe", name: "Esquina Sur", isOps: false },
    { email: "demo-consumer@punch.pe", name: "Consumidor Demo", isOps: false },
] as const;

async function main() {
    const password = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
    if (!password) {
        throw new Error("NEXT_PUBLIC_DEMO_PASSWORD is required to seed demo accounts");
    }
    for (const acct of DEMO_ACCOUNTS) {
        const [existing] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, acct.email));
        if (existing) {
            console.log(`= ${acct.email} already seeded`);
            continue;
        }
        // Better Auth server API — fires databaseHooks, so wallet gets assigned.
        await auth.api.signUpEmail({
            body: { email: acct.email, password, name: acct.name },
        });
        if (acct.isOps) {
            await db
                .update(user)
                .set({ isOps: true })
                .where(eq(user.email, acct.email));
        }
        console.log(`+ seeded ${acct.email}`);
    }
    const rows = await db
        .select({ email: user.email, walletAddress: user.walletAddress })
        .from(user);
    for (const r of rows) {
        if (!r.walletAddress) {
            throw new Error(`seed verification failed: ${r.email} has no wallet`);
        }
    }
    console.log("Seed OK — all users have wallets.");
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
```

- [ ] **Step 2: Add script to package.json**

In root `package.json` scripts:

```json
"db:seed": "tsx --env-file=.env scripts/seed.ts"
```

Note: `scripts/migrate.ts` already runs via tsx with `--env-file`; if importing `@/server/auth/auth` pulls `server-only`/`next/headers` into a non-Next process and tsx fails, register the same alias workaround `scripts/migrate.ts` uses (check that file); as a fallback, create the user with Better Auth's password hashing via `auth.api` inside a minimal Next-free context — but try the direct import first, `next/headers` is only touched by `authenticate`, which the seed never calls.

- [ ] **Step 3: Run seed twice to verify idempotency**

Run: `pnpm db:seed && pnpm db:seed`
Expected: first run prints `+ seeded ...` six times and `Seed OK`; second run prints `= ... already seeded` six times and `Seed OK`. (Requires reachable `DATABASE_URL` + migrated schema; if DB unavailable in this environment, mark step blocked in the commit body — do not fake success.)

- [ ] **Step 4: Demo login component**

`src/frontend/components/auth/demo-login.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { env } from "@/config/env";
import { authClient } from "@/frontend/auth/auth";
import { Button } from "@/frontend/components/ui/button";

const DEMO_LOGINS = [
    { label: "Entrar como consumidor demo", email: "demo-consumer@punch.pe" },
    { label: "Entrar como Café Brújula", email: "brujula@punch.pe" },
    { label: "Entrar como Ops", email: "demo-ops@punch.pe" },
] as const;

export function DemoLogin() {
    const router = useRouter();
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    if (!env.NEXT_PUBLIC_DEMO_MODE || !env.NEXT_PUBLIC_DEMO_PASSWORD) {
        return null;
    }
    const password = env.NEXT_PUBLIC_DEMO_PASSWORD;

    async function signInAs(email: string) {
        setPending(email);
        setError(null);
        const { error: signInError } = await authClient.signIn.email({
            email,
            password,
        });
        if (signInError) {
            setError("No se pudo iniciar la demo. ¿Corriste pnpm db:seed?");
            setPending(null);
            return;
        }
        router.push("/");
        router.refresh();
    }

    return (
        <div className="mt-6 flex flex-col gap-2">
            <p className="text-center text-sm text-muted-foreground">
                Probar demo
            </p>
            {DEMO_LOGINS.map((demo) => (
                <Button
                    key={demo.email}
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => signInAs(demo.email)}
                >
                    {pending === demo.email ? "Entrando…" : demo.label}
                </Button>
            ))}
            {error ? (
                <p className="text-center text-sm text-destructive">{error}</p>
            ) : null}
        </div>
    );
}
```

(If the Button component lives at a different path, find it with `ls src/frontend/components/ui/` and match the existing import convention used by other auth components.)

- [ ] **Step 5: Render in auth page**

In `src/app/auth/[path]/page.tsx`, render `<DemoLogin />` directly below the existing auth view component, inside the same layout container. Import: `import { DemoLogin } from "@/frontend/components/auth/demo-login";`. Do not alter existing auth behavior.

- [ ] **Step 6: Verify + commit**

Run: `pnpm check:fix && pnpm typecheck && pnpm test`
Expected: PASS. Manual check if dev server available: `/auth/sign-in` shows "Probar demo" buttons; clicking one lands signed-in on `/`.

```bash
git add scripts/seed.ts package.json src/frontend/components/auth/demo-login.tsx "src/app/auth/[path]/page.tsx"
git commit -m "feat(identity): demo seed script and one-click demo logins"
```

---

## Acceptance checklist (spec 3a)

- [ ] Signup (normal or seeded) → user has `wallet_index` + `wallet_address`; no key material stored.
- [ ] Same index always derives same address (tests).
- [ ] `assignWallet` idempotent + race-safe (tests).
- [ ] `requireCafeRole` / `requireOps` allow/deny correctly (tests).
- [ ] Seed runs twice without duplicates.
- [ ] Demo buttons visible only with `NEXT_PUBLIC_DEMO_MODE=true` + password set.
- [ ] Missing/invalid mnemonic fails env validation at boot.
