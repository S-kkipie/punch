# Cafe Domain (3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/core/cafe` domain: café profile + onboarding workflow (`draft→submitted→approved|rejected`) + product catalog (emission/reward, reward retail ≤ S/12) in Postgres, with owner panel, ops review console, and consumer discovery list, seeded with the 4 cafés from master spec §30.

**Architecture:** Clone of the existing `src/core/project` layering — zod domain schemas → per-route Elysia files → thin services returning `AppResult` → single-query repository files. Authorization via 3a's `requireCafeRole`/`requireOps`. Postgres-only source data (master spec §18); no on-chain projection tables yet — `cafe.id`/`cafe_product.id` uuids are the future chain-mapping keys.

**Tech Stack:** Drizzle + Postgres, Elysia + zod, Eden + TanStack Query, TanStack Form, shadcn/Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-07-cafe-domain-design.md` (master spec §07, §15–§19, §21, §30).

**Depends on:** 3a merged (`cafe_member` table, guards, seed base). Do not start Tasks 1–9 before 3a's Task 2 (schema) exists on the branch you fork from.

## Global Constraints

- Reward product invariant (master spec §02.6): `price_soles ≤ 12` — enforced in zod AND a DB check constraint. Copy: error message `"Un producto reward no puede superar S/12 de precio retail"`.
- COGS guidance (§07): reward `cogs_soles` required; `cogs > 3` is a UI warning, never a server rejection.
- Onboarding transitions: `draft→submitted`, `submitted→approved`, `submitted→rejected`, `rejected→submitted`. Anything else → 409 CONFLICT.
- `rejected` states must carry `review_note` (actionable reason, §21).
- Public reads expose only `approved` cafés and `approved` + `active` products; PII fields (`ruc`, `contact_phone`) never appear in public responses.
- Monetary columns: `numeric` in Postgres, string in wire types (avoid float money math).
- Run `pnpm check:fix && pnpm typecheck && pnpm test` before each commit.
- Branch from the 3a branch (or main once 3a merged) in a worktree, branch name `feat/cafe-domain`.

---

### Task 1: Schema — cafe + cafe_product + FK backfill

**Files:**
- Modify: `src/server/drizzle/schemas/cafe-schema.ts`
- Create: generated SQL under `drizzle/` (via `pnpm db:generate`)

**Interfaces:**
- Consumes: 3a `cafeMember` (same file), `user` from auth-schema.
- Produces: `cafe`, `cafeProduct` tables; enums `cafeOnboardingStatus` (`draft|submitted|approved|rejected`), `cafeProductType` (`emission|reward`), `productApprovalStatus` (`pending|approved|rejected`); row types `CafeRow`, `NewCafeRow`, `CafeProductRow`, `NewCafeProductRow`. FK from `cafeMember.cafeId` → `cafe.id`.

- [ ] **Step 1: Extend cafe-schema.ts**

Append to `src/server/drizzle/schemas/cafe-schema.ts` (adding `check`, `numeric`, `boolean`, `sql` imports):

```ts
export const cafeOnboardingStatus = pgEnum("cafe_onboarding_status", [
    "draft",
    "submitted",
    "approved",
    "rejected",
]);

export const cafe = pgTable(
    "cafe",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        name: text("name").notNull(),
        slug: text("slug").notNull().unique(),
        description: text("description"),
        address: text("address"),
        district: text("district"),
        lat: numeric("lat"),
        lng: numeric("lng"),
        photoUrl: text("photo_url"),
        ruc: text("ruc"),
        contactPhone: text("contact_phone"),
        onboardingStatus: cafeOnboardingStatus("onboarding_status")
            .default("draft")
            .notNull(),
        reviewNote: text("review_note"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("cafe_onboarding_status_idx").on(table.onboardingStatus),
        check("cafe_name_not_empty", sql`length(trim(${table.name})) > 0`),
    ],
);

export const cafeProductType = pgEnum("cafe_product_type", [
    "emission",
    "reward",
]);
export const productApprovalStatus = pgEnum("product_approval_status", [
    "pending",
    "approved",
    "rejected",
]);

export const cafeProduct = pgTable(
    "cafe_product",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        description: text("description"),
        priceSoles: numeric("price_soles").notNull(),
        cogsSoles: numeric("cogs_soles"),
        type: cafeProductType("type").notNull(),
        approvalStatus: productApprovalStatus("approval_status")
            .default("pending")
            .notNull(),
        reviewNote: text("review_note"),
        active: boolean("active").default(true).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("cafe_product_cafe_id_idx").on(table.cafeId),
        check("cafe_product_price_positive", sql`${table.priceSoles} > 0`),
        check(
            "cafe_product_reward_price_cap",
            sql`${table.type} <> 'reward' OR ${table.priceSoles} <= 12`,
        ),
    ],
);

export type CafeRow = typeof cafe.$inferSelect;
export type NewCafeRow = typeof cafe.$inferInsert;
export type CafeProductRow = typeof cafeProduct.$inferSelect;
export type NewCafeProductRow = typeof cafeProduct.$inferInsert;
```

Also change `cafeMember.cafeId` to add the now-possible FK:

```ts
        cafeId: text("cafe_id")
            .notNull()
            .references(() => cafe.id, { onDelete: "cascade" }),
```

(Declare `cafe` above `cafeMember` in the file to avoid forward reference.)

- [ ] **Step 2: Generate migration and inspect**

Run: `pnpm db:generate`
Expected: SQL creating both tables + enums + `cafe_member` FK. Must NOT drop `cafe_member` rows (empty in fresh DBs anyway).

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm test`

```bash
git add src/server/drizzle drizzle
git commit -m "feat(cafe): cafe and cafe_product schema with reward price cap"
```

---

### Task 2: Domain schemas + transition rules

**Files:**
- Create: `src/core/cafe/domain/schemas.ts`
- Create: `src/core/cafe/domain/types.ts`
- Create: `src/core/cafe/domain/transitions.ts`
- Test: `src/core/cafe/domain/__tests__/schemas.test.ts`

**Interfaces:**
- Consumes: zod, row types from Task 1.
- Produces (exact names used by Tasks 3–5):
  - Schemas: `createCafeSchema`, `updateCafeSchema`, `cafeSchema` (wire, no PII), `cafeAdminSchema` (wire with PII), `reviewSchema` (`{ decision: "approved" | "rejected"; reviewNote?: string }`), `createProductSchema`, `updateProductSchema`, `productSchema`.
  - Types (z.infer): `CreateCafe`, `UpdateCafe`, `Cafe`, `CafeAdmin`, `Review`, `CreateProduct`, `UpdateProduct`, `Product`.
  - `canTransition(from: CafeOnboardingStatus, to: CafeOnboardingStatus): boolean`.
  - `submissionGaps(cafe: CafeAdmin, emissionProductCount: number): string[]` — empty array ⇔ submittable.

- [ ] **Step 1: Write the failing test**

`src/core/cafe/domain/__tests__/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    createCafeSchema,
    createProductSchema,
} from "../schemas";
import { canTransition, submissionGaps } from "../transitions";

describe("createProductSchema", () => {
    const base = { name: "Latte", priceSoles: "10.50", type: "emission" as const };

    it("accepts a valid emission product", () => {
        expect(createProductSchema.safeParse(base).success).toBe(true);
    });

    it("rejects reward with price above S/12", () => {
        const r = createProductSchema.safeParse({
            ...base,
            type: "reward",
            priceSoles: "12.50",
            cogsSoles: "3.00",
        });
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(JSON.stringify(r.error.issues)).toContain(
                "Un producto reward no puede superar S/12",
            );
        }
    });

    it("accepts reward at exactly S/12", () => {
        const r = createProductSchema.safeParse({
            ...base,
            type: "reward",
            priceSoles: "12",
            cogsSoles: "2.80",
        });
        expect(r.success).toBe(true);
    });

    it("rejects reward without cogs", () => {
        const r = createProductSchema.safeParse({
            ...base,
            type: "reward",
            priceSoles: "10",
        });
        expect(r.success).toBe(false);
    });

    it("rejects non-positive price", () => {
        expect(
            createProductSchema.safeParse({ ...base, priceSoles: "0" }).success,
        ).toBe(false);
    });
});

describe("createCafeSchema", () => {
    it("requires a name", () => {
        expect(createCafeSchema.safeParse({ name: " " }).success).toBe(false);
        expect(createCafeSchema.safeParse({ name: "Brújula" }).success).toBe(true);
    });
});

describe("canTransition", () => {
    it.each([
        ["draft", "submitted", true],
        ["submitted", "approved", true],
        ["submitted", "rejected", true],
        ["rejected", "submitted", true],
        ["draft", "approved", false],
        ["approved", "rejected", false],
        ["approved", "submitted", false],
        ["rejected", "approved", false],
    ] as const)("%s → %s = %s", (from, to, allowed) => {
        expect(canTransition(from, to)).toBe(allowed);
    });
});

describe("submissionGaps", () => {
    const full = {
        id: "c1", name: "Brújula", slug: "brujula", description: null,
        address: "Av. Larco 123", district: "Miraflores", lat: null, lng: null,
        photoUrl: null, ruc: "20123456789", contactPhone: "+51 999 999 999",
        onboardingStatus: "draft" as const, reviewNote: null,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };

    it("empty gaps when complete with one emission product", () => {
        expect(submissionGaps(full, 1)).toEqual([]);
    });

    it("lists each missing field and missing emission product", () => {
        const gaps = submissionGaps(
            { ...full, address: null, contactPhone: null },
            0,
        );
        expect(gaps).toContain("address");
        expect(gaps).toContain("contactPhone");
        expect(gaps).toContain("emissionProduct");
    });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm test -- src/core/cafe`

- [ ] **Step 3: Implement**

`src/core/cafe/domain/schemas.ts` (money as decimal strings; follow `src/core/project/domain/schemas.ts` conventions for wire dates as ISO strings):

```ts
import { z } from "zod";

const decimalString = z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Monto inválido (usa formato 10.50)");

const positiveDecimal = decimalString.refine((v) => Number(v) > 0, {
    message: "El precio debe ser mayor a 0",
});

export const cafeOnboardingStatusSchema = z.enum([
    "draft",
    "submitted",
    "approved",
    "rejected",
]);
export const productTypeSchema = z.enum(["emission", "reward"]);
export const productApprovalSchema = z.enum(["pending", "approved", "rejected"]);

export const createCafeSchema = z.object({
    name: z.string().trim().min(1, "Nombre requerido").max(120),
    description: z.string().trim().max(500).optional(),
});

export const updateCafeSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullish(),
    address: z.string().trim().max(200).nullish(),
    district: z.string().trim().max(80).nullish(),
    lat: z.string().nullish(),
    lng: z.string().nullish(),
    photoUrl: z.url().nullish(),
    ruc: z.string().trim().regex(/^\d{11}$/, "RUC de 11 dígitos").nullish(),
    contactPhone: z.string().trim().min(6).max(20).nullish(),
});

/** Public wire shape — NO ruc / contactPhone. */
export const cafeSchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    address: z.string().nullable(),
    district: z.string().nullable(),
    lat: z.string().nullable(),
    lng: z.string().nullable(),
    photoUrl: z.string().nullable(),
    onboardingStatus: cafeOnboardingStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** Owner/ops wire shape — includes PII + review note. */
export const cafeAdminSchema = cafeSchema.extend({
    ruc: z.string().nullable(),
    contactPhone: z.string().nullable(),
    reviewNote: z.string().nullable(),
});

export const reviewSchema = z
    .object({
        decision: z.enum(["approved", "rejected"]),
        reviewNote: z.string().trim().max(500).optional(),
    })
    .refine((r) => r.decision !== "rejected" || !!r.reviewNote, {
        message: "Un rechazo debe incluir una razón accionable",
        path: ["reviewNote"],
    });

const productBase = z.object({
    name: z.string().trim().min(1, "Nombre requerido").max(120),
    description: z.string().trim().max(300).optional(),
    priceSoles: positiveDecimal,
    cogsSoles: decimalString.optional(),
    type: productTypeSchema,
});

const rewardRules = (p: { type: string; priceSoles: string; cogsSoles?: string }, ctx: z.RefinementCtx) => {
    if (p.type !== "reward") return;
    if (Number(p.priceSoles) > 12) {
        ctx.addIssue({
            code: "custom",
            path: ["priceSoles"],
            message: "Un producto reward no puede superar S/12 de precio retail",
        });
    }
    if (!p.cogsSoles) {
        ctx.addIssue({
            code: "custom",
            path: ["cogsSoles"],
            message: "Un producto reward requiere COGS",
        });
    }
};

export const createProductSchema = productBase.superRefine(rewardRules);
export const updateProductSchema = productBase
    .partial()
    .extend({ active: z.boolean().optional() });
// Note: full reward re-validation on update happens in the service, which
// merges the patch onto the existing row and re-runs createProductSchema.

export const productSchema = z.object({
    id: z.string(),
    cafeId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    priceSoles: z.string(),
    cogsSoles: z.string().nullable(),
    type: productTypeSchema,
    approvalStatus: productApprovalSchema,
    reviewNote: z.string().nullable(),
    active: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
```

`src/core/cafe/domain/types.ts`:

```ts
import type { z } from "zod";
import type {
    cafeAdminSchema,
    cafeOnboardingStatusSchema,
    cafeSchema,
    createCafeSchema,
    createProductSchema,
    productSchema,
    reviewSchema,
    updateCafeSchema,
    updateProductSchema,
} from "./schemas";

export type CafeOnboardingStatus = z.infer<typeof cafeOnboardingStatusSchema>;
export type CreateCafe = z.infer<typeof createCafeSchema>;
export type UpdateCafe = z.infer<typeof updateCafeSchema>;
export type Cafe = z.infer<typeof cafeSchema>;
export type CafeAdmin = z.infer<typeof cafeAdminSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type CreateProduct = z.infer<typeof createProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;
export type Product = z.infer<typeof productSchema>;
```

`src/core/cafe/domain/transitions.ts`:

```ts
import type { CafeAdmin, CafeOnboardingStatus } from "./types";

const ALLOWED: Record<CafeOnboardingStatus, CafeOnboardingStatus[]> = {
    draft: ["submitted"],
    submitted: ["approved", "rejected"],
    approved: [],
    rejected: ["submitted"],
};

export function canTransition(
    from: CafeOnboardingStatus,
    to: CafeOnboardingStatus,
): boolean {
    return ALLOWED[from].includes(to);
}

/** Fields still missing before a café can be submitted (spec 3b). */
export function submissionGaps(
    cafe: CafeAdmin,
    emissionProductCount: number,
): string[] {
    const gaps: string[] = [];
    if (!cafe.name?.trim()) gaps.push("name");
    if (!cafe.address?.trim()) gaps.push("address");
    if (!cafe.district?.trim()) gaps.push("district");
    if (!cafe.contactPhone?.trim()) gaps.push("contactPhone");
    if (emissionProductCount < 1) gaps.push("emissionProduct");
    return gaps;
}
```

- [ ] **Step 4: Run to verify PASS** — `pnpm test -- src/core/cafe`

- [ ] **Step 5: Commit**

```bash
git add src/core/cafe/domain
git commit -m "feat(cafe): domain schemas, reward price cap, onboarding transitions"
```

---

### Task 3: Cafe repository + services

**Files:**
- Create: `src/core/cafe/server/repository/utils.ts`
- Create: `src/core/cafe/server/repository/create-cafe.ts`
- Create: `src/core/cafe/server/repository/find-cafe-by-id.ts`
- Create: `src/core/cafe/server/repository/list-approved-cafes.ts`
- Create: `src/core/cafe/server/repository/list-cafes-by-status.ts`
- Create: `src/core/cafe/server/repository/update-cafe.ts`
- Create: `src/core/cafe/server/repository/count-emission-products.ts`
- Create: `src/core/cafe/server/repository/add-member.ts`
- Create: `src/core/cafe/server/services/create-cafe-service.ts`
- Create: `src/core/cafe/server/services/get-cafe-service.ts`
- Create: `src/core/cafe/server/services/list-cafes-service.ts`
- Create: `src/core/cafe/server/services/update-cafe-service.ts`
- Create: `src/core/cafe/server/services/submit-cafe-service.ts`
- Create: `src/core/cafe/server/services/review-cafe-service.ts`
- Test: `src/core/cafe/server/services/__tests__/cafe-services.test.ts`

**Interfaces:**
- Consumes: Task 1 rows, Task 2 domain, 3a `requireCafeRole`/`requireOps`, `AppErrors`/`ok`/`err`.
- Produces (used by Task 4 routes):
  - `createCafeService(userId: string, input: CreateCafe): AsyncAppResult<CafeAdmin>` — creates draft + owner membership (via `addMember`), slug = slugified name + `-` + 4-char nanoid suffix on collision.
  - `getCafeService(viewer: { id: string; isOps?: boolean | null } | null, cafeId: string): AsyncAppResult<Cafe | CafeAdmin>` — admin shape for owner/ops, public shape (approved only) otherwise, else NOT_FOUND.
  - `listCafesService(): AsyncAppResult<Cafe[]>` — approved only.
  - `listCafesByStatusService(user, status): AsyncAppResult<CafeAdmin[]>` — ops only.
  - `updateCafeService(userId, cafeId, patch: UpdateCafe): AsyncAppResult<CafeAdmin>` — owner only; allowed in any status except `submitted` (locked while under review).
  - `submitCafeService(userId, cafeId): AsyncAppResult<CafeAdmin>` — owner only; 422 with `targets: gaps` when incomplete; 409 on bad transition.
  - `reviewCafeService(user, cafeId, review: Review): AsyncAppResult<CafeAdmin>` — ops only; 409 unless `submitted`.
  - Repository `toCafe(row): Cafe` / `toCafeAdmin(row): CafeAdmin` in `utils.ts` (dates → ISO strings, drop/keep PII).

- [ ] **Step 1: Write failing service tests**

`src/core/cafe/server/services/__tests__/cafe-services.test.ts` — mock all repository modules and the membership guard, mirroring `project-services.test.ts` style:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/create-cafe", () => ({ createCafe: vi.fn() }));
vi.mock("../../repository/find-cafe-by-id", () => ({ findCafeById: vi.fn() }));
vi.mock("../../repository/list-approved-cafes", () => ({ listApprovedCafes: vi.fn() }));
vi.mock("../../repository/list-cafes-by-status", () => ({ listCafesByStatus: vi.fn() }));
vi.mock("../../repository/update-cafe", () => ({ updateCafe: vi.fn() }));
vi.mock("../../repository/count-emission-products", () => ({ countEmissionProducts: vi.fn() }));
vi.mock("../../repository/add-member", () => ({ addMember: vi.fn() }));
vi.mock("@/server/auth/membership/require-cafe-role", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/server/auth/membership/require-cafe-role")>();
    return { ...actual, requireCafeRole: vi.fn() };
});

import { ok as okResult } from "@/server/common/responses";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { countEmissionProducts } from "../../repository/count-emission-products";
import { findCafeById } from "../../repository/find-cafe-by-id";
import { updateCafe } from "../../repository/update-cafe";
import { reviewCafeService } from "../review-cafe-service";
import { submitCafeService } from "../submit-cafe-service";

const row = {
    id: "c1", name: "Brújula", slug: "brujula", description: null,
    address: "Av. Larco 123", district: "Miraflores", lat: null, lng: null,
    photoUrl: null, ruc: "20123456789", contactPhone: "+51999999999",
    onboardingStatus: "draft" as const, reviewNote: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
};
const membership = {
    id: "m1", userId: "u1", cafeId: "c1", role: "owner" as const,
    createdAt: new Date(),
};

describe("submitCafeService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("submits a complete draft", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue(row);
        vi.mocked(countEmissionProducts).mockResolvedValue(1);
        vi.mocked(updateCafe).mockResolvedValue({
            ...row,
            onboardingStatus: "submitted",
        });
        const r = await submitCafeService("u1", "c1");
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.onboardingStatus).toBe("submitted");
    });

    it("422 with gap targets when incomplete", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue({ ...row, address: null });
        vi.mocked(countEmissionProducts).mockResolvedValue(0);
        const r = await submitCafeService("u1", "c1");
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error.status).toBe(422);
            expect(r.error.type === "UnprocessableEntityError" && r.error.targets)
                .toEqual(expect.arrayContaining(["address", "emissionProduct"]));
        }
    });

    it("409 when not draft/rejected", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
        vi.mocked(findCafeById).mockResolvedValue({
            ...row,
            onboardingStatus: "approved",
        });
        vi.mocked(countEmissionProducts).mockResolvedValue(1);
        const r = await submitCafeService("u1", "c1");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(409);
    });
});

describe("reviewCafeService", () => {
    beforeEach(() => vi.clearAllMocks());
    const ops = { id: "op1", isOps: true };

    it("forbids non-ops", async () => {
        const r = await reviewCafeService({ id: "u1", isOps: false }, "c1", {
            decision: "approved",
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(403);
    });

    it("approves a submitted cafe", async () => {
        vi.mocked(findCafeById).mockResolvedValue({
            ...row,
            onboardingStatus: "submitted",
        });
        vi.mocked(updateCafe).mockResolvedValue({
            ...row,
            onboardingStatus: "approved",
        });
        const r = await reviewCafeService(ops, "c1", { decision: "approved" });
        expect(r.ok).toBe(true);
    });

    it("409 when reviewing a draft", async () => {
        vi.mocked(findCafeById).mockResolvedValue(row);
        const r = await reviewCafeService(ops, "c1", { decision: "approved" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.status).toBe(409);
    });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm test -- src/core/cafe/server`

- [ ] **Step 3: Implement repositories**

Each repository file is one query, `import "server-only"`, drizzle style identical to `src/core/project/server/repository/*`. Key ones:

`utils.ts`:

```ts
import "server-only";
import type { Cafe, CafeAdmin } from "@/core/cafe/domain/types";
import type { CafeRow } from "@/server/drizzle/schemas/cafe-schema";

export function toCafeAdmin(row: CafeRow): CafeAdmin {
    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        address: row.address,
        district: row.district,
        lat: row.lat,
        lng: row.lng,
        photoUrl: row.photoUrl,
        ruc: row.ruc,
        contactPhone: row.contactPhone,
        onboardingStatus: row.onboardingStatus,
        reviewNote: row.reviewNote,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function toCafe(row: CafeRow): Cafe {
    const { ruc: _ruc, contactPhone: _phone, reviewNote: _note, ...rest } =
        toCafeAdmin(row);
    return rest;
}

export function slugify(name: string): string {
    return name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}
```

`create-cafe.ts` inserts with slug collision retry (on unique violation append `-${nanoid(4)}` using existing `nanoid` dep). `count-emission-products.ts`:

```ts
import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { cafeProduct } from "@/server/drizzle/schemas/cafe-schema";

export async function countEmissionProducts(cafeId: string): Promise<number> {
    const [row] = await db
        .select({ n: count() })
        .from(cafeProduct)
        .where(and(eq(cafeProduct.cafeId, cafeId), eq(cafeProduct.type, "emission")));
    return row?.n ?? 0;
}
```

`add-member.ts` inserts into `cafeMember` with `onConflictDoNothing()`. `update-cafe.ts` takes `(cafeId, patch: Partial<NewCafeRow>)` and returns the updated row. `list-approved-cafes.ts` filters `onboardingStatus = 'approved'`. `list-cafes-by-status.ts` filters by given status.

- [ ] **Step 4: Implement services**

All follow the project-service pattern (`try/catch` → `err(AppErrors.unexpected(cause))`). Core logic:

`submit-cafe-service.ts`:

```ts
import "server-only";
import { canTransition, submissionGaps } from "@/core/cafe/domain/transitions";
import type { CafeAdmin } from "@/core/cafe/domain/types";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { AppErrors, type AsyncAppResult, err, ok } from "@/server/common/responses";
import { countEmissionProducts } from "../repository/count-emission-products";
import { findCafeById } from "../repository/find-cafe-by-id";
import { updateCafe } from "../repository/update-cafe";
import { toCafeAdmin } from "../repository/utils";

export async function submitCafeService(
    userId: string,
    cafeId: string,
): AsyncAppResult<CafeAdmin> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;
        const row = await findCafeById(cafeId);
        if (!row) return err(AppErrors.notFound({ targets: ["cafeId"] }));
        if (!canTransition(row.onboardingStatus, "submitted")) {
            return err(AppErrors.conflict({ targets: ["onboardingStatus"] }));
        }
        const gaps = submissionGaps(
            toCafeAdmin(row),
            await countEmissionProducts(cafeId),
        );
        if (gaps.length > 0) {
            return err(AppErrors.unprocessableEntity({ targets: gaps }));
        }
        const updated = await updateCafe(cafeId, {
            onboardingStatus: "submitted",
            reviewNote: null,
        });
        return ok(toCafeAdmin(updated));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
```

`review-cafe-service.ts`:

```ts
import "server-only";
import { canTransition } from "@/core/cafe/domain/transitions";
import type { CafeAdmin, Review } from "@/core/cafe/domain/types";
import { requireOps } from "@/server/auth/membership/require-cafe-role";
import { AppErrors, type AsyncAppResult, err, ok } from "@/server/common/responses";
import { findCafeById } from "../repository/find-cafe-by-id";
import { updateCafe } from "../repository/update-cafe";
import { toCafeAdmin } from "../repository/utils";

export async function reviewCafeService(
    user: { id: string; isOps?: boolean | null },
    cafeId: string,
    review: Review,
): AsyncAppResult<CafeAdmin> {
    try {
        const ops = requireOps(user);
        if (!ops.ok) return ops;
        const row = await findCafeById(cafeId);
        if (!row) return err(AppErrors.notFound({ targets: ["cafeId"] }));
        if (!canTransition(row.onboardingStatus, review.decision)) {
            return err(AppErrors.conflict({ targets: ["onboardingStatus"] }));
        }
        const updated = await updateCafe(cafeId, {
            onboardingStatus: review.decision,
            reviewNote: review.reviewNote ?? null,
        });
        return ok(toCafeAdmin(updated));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
```

`create-cafe-service.ts` creates the row then `addMember(userId, cafeId, "owner")`. `updateCafeService` rejects with 409 when `onboardingStatus === "submitted"`. `getCafeService`: owner/ops → `toCafeAdmin`; anonymous/other → `toCafe` only if approved, else `notFound` (don't leak existence).

- [ ] **Step 5: Run to verify PASS** — `pnpm test -- src/core/cafe`

- [ ] **Step 6: Commit**

```bash
git add src/core/cafe/server
git commit -m "feat(cafe): cafe repositories and onboarding services"
```

---

### Task 4: Cafe routes + router registration

**Files:**
- Create: `src/core/cafe/server/api/routes/create-cafe.route.ts`
- Create: `src/core/cafe/server/api/routes/list-cafes.route.ts`
- Create: `src/core/cafe/server/api/routes/get-cafe.route.ts`
- Create: `src/core/cafe/server/api/routes/update-cafe.route.ts`
- Create: `src/core/cafe/server/api/routes/submit-cafe.route.ts`
- Create: `src/core/cafe/server/api/routes/review-cafe.route.ts`
- Create: `src/core/cafe/server/api/routes/list-review-queue.route.ts`
- Create: `src/core/cafe/server/api/router.ts`
- Modify: `src/server/router.ts` (add `.use(cafeRouter)`)

**Interfaces:**
- Consumes: Task 2 schemas, Task 3 services, `authed` macro, `CommonResponse`/`errorToResponse` helpers.
- Produces: `/api/v1/cafes` endpoints; `cafeRouter` Elysia instance; Eden types flow automatically via `AppRouter`.

- [ ] **Step 1: Implement routes**

Follow `create-project.route.ts` exactly. Mapping:

| File | Method/path | Guard | Service |
|---|---|---|---|
| create-cafe.route | POST `/` | authed | `createCafeService(user.id, body)` → 201 |
| list-cafes.route | GET `/` | public | `listCafesService()` → 200 |
| get-cafe.route | GET `/:id` | optional session (resolve session manually via `auth.api.getSession`, may be null) | `getCafeService(viewer, params.id)` → 200 |
| update-cafe.route | PATCH `/:id` | authed | `updateCafeService(user.id, params.id, body)` → 200 |
| submit-cafe.route | POST `/:id/submit` | authed | `submitCafeService(user.id, params.id)` → 200 |
| review-cafe.route | POST `/:id/review` | authed | `reviewCafeService(user, params.id, body)` → 200 |
| list-review-queue.route | GET `/review-queue` | authed | `listCafesByStatusService(user, "submitted")` → 200 |

Register error statuses per route: 400/401/403/404/409/422/500 as each service can produce (copy the `errorResponseSchema(...)` pattern). `review-cafe.route` body: `reviewSchema`. Tags: `["Cafes"]`.

`router.ts`:

```ts
import { Elysia } from "elysia";
import { createCafeRoute } from "./routes/create-cafe.route";
import { getCafeRoute } from "./routes/get-cafe.route";
import { listCafesRoute } from "./routes/list-cafes.route";
import { listReviewQueueRoute } from "./routes/list-review-queue.route";
import { reviewCafeRoute } from "./routes/review-cafe.route";
import { submitCafeRoute } from "./routes/submit-cafe.route";
import { updateCafeRoute } from "./routes/update-cafe.route";

export const cafeRouter = new Elysia({ prefix: "/cafes" })
    .use(createCafeRoute)
    .use(listCafesRoute)
    .use(listReviewQueueRoute) // before /:id so "review-queue" isn't captured
    .use(getCafeRoute)
    .use(updateCafeRoute)
    .use(submitCafeRoute)
    .use(reviewCafeRoute);
```

In `src/server/router.ts` add `.use(cafeRouter)` next to `.use(projectRouter)`.

- [ ] **Step 2: Verify + commit**

Run: `pnpm check:fix && pnpm typecheck && pnpm test`
Expected: PASS. If dev server + DB available: `GET /api/v1/cafes` returns `[]`-shaped success payload.

```bash
git add src/core/cafe/server/api src/server/router.ts
git commit -m "feat(cafe): cafe onboarding and review API routes"
```

---

### Task 5: Product services + routes

**Files:**
- Create: `src/core/cafe/server/repository/create-product.ts`
- Create: `src/core/cafe/server/repository/find-product-by-id.ts`
- Create: `src/core/cafe/server/repository/list-products-by-cafe.ts`
- Create: `src/core/cafe/server/repository/list-pending-products.ts`
- Create: `src/core/cafe/server/repository/update-product.ts`
- Create: `src/core/cafe/server/services/create-product-service.ts`
- Create: `src/core/cafe/server/services/update-product-service.ts`
- Create: `src/core/cafe/server/services/review-product-service.ts`
- Create: `src/core/cafe/server/services/list-products-service.ts`
- Create: `src/core/cafe/server/api/routes/create-product.route.ts`
- Create: `src/core/cafe/server/api/routes/list-products.route.ts`
- Create: `src/core/cafe/server/api/routes/update-product.route.ts`
- Create: `src/core/cafe/server/api/routes/review-product.route.ts`
- Create: `src/core/cafe/server/api/routes/list-pending-products.route.ts`
- Modify: `src/core/cafe/server/api/router.ts`
- Test: `src/core/cafe/server/services/__tests__/product-services.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `createProductService(userId, cafeId, input: CreateProduct): AsyncAppResult<Product>` — owner only; new products start `pending`.
  - `updateProductService(userId, productId, patch: UpdateProduct): AsyncAppResult<Product>` — owner of the product's café; merges patch onto row, re-runs `createProductSchema` (re-validates reward cap), resets `approvalStatus` to `pending` when `priceSoles`, `type`, or `cogsSoles` changed.
  - `reviewProductService(user, productId, review: Review): AsyncAppResult<Product>` — ops only; only `pending` reviewable.
  - `listProductsService(viewer, cafeId): AsyncAppResult<Product[]>` — owner/ops: all; public: approved + active only.
  - Routes under `/cafes/:id/products` + `/cafes/products/:productId` (flat product paths avoid nested param clash) + `/cafes/products/pending` (ops queue).
  - `toProduct(row: CafeProductRow): Product` in `utils.ts`.

- [ ] **Step 1: Write failing tests** — same mocking pattern as Task 3. Cover: create as owner OK / as non-member 403; update resets approval on price change but keeps it on name-only change; update that turns emission→reward without cogs → 422; reward price >12 on update → 422; review by non-ops 403; review of already-approved product 409; public list excludes pending/inactive.

Test skeleton (same conventions; key assertions):

```ts
it("resets approval to pending when price changes", async () => {
    vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
    vi.mocked(findProductById).mockResolvedValue(productRow); // approved, 10.00
    vi.mocked(updateProduct).mockImplementation(async (_id, patch) => ({
        ...productRow,
        ...patch,
    }));
    const r = await updateProductService("u1", "p1", { priceSoles: "11.00" });
    expect(r.ok).toBe(true);
    expect(updateProduct).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ approvalStatus: "pending" }),
    );
});

it("keeps approval on cosmetic change", async () => {
    vi.mocked(requireCafeRole).mockResolvedValue(okResult(membership));
    vi.mocked(findProductById).mockResolvedValue(productRow);
    vi.mocked(updateProduct).mockImplementation(async (_id, patch) => ({
        ...productRow,
        ...patch,
    }));
    await updateProductService("u1", "p1", { name: "Latte doble" });
    expect(updateProduct).toHaveBeenCalledWith(
        "p1",
        expect.not.objectContaining({ approvalStatus: "pending" }),
    );
});
```

- [ ] **Step 2: FAIL** — `pnpm test -- src/core/cafe`

- [ ] **Step 3: Implement** — services follow Task 3 pattern; `updateProductService` core:

```ts
const merged = {
    name: patch.name ?? row.name,
    description: patch.description ?? row.description ?? undefined,
    priceSoles: patch.priceSoles ?? row.priceSoles,
    cogsSoles: patch.cogsSoles ?? row.cogsSoles ?? undefined,
    type: patch.type ?? row.type,
};
const revalidated = createProductSchema.safeParse(merged);
if (!revalidated.success) {
    return err(
        AppErrors.unprocessableEntity({
            targets: revalidated.error.issues.map((i) => String(i.path[0])),
            cause: revalidated.error,
        }),
    );
}
const economicChange =
    (patch.priceSoles !== undefined && patch.priceSoles !== row.priceSoles) ||
    (patch.type !== undefined && patch.type !== row.type) ||
    (patch.cogsSoles !== undefined && patch.cogsSoles !== row.cogsSoles);
```

- [ ] **Step 4: PASS** — `pnpm test -- src/core/cafe`

- [ ] **Step 5: Commit**

```bash
git add src/core/cafe
git commit -m "feat(cafe): product catalog services and routes with re-approval on economic change"
```

---

### Task 6: Client hooks

**Files:**
- Create: `src/core/cafe/client/hooks.ts`

**Interfaces:**
- Consumes: Eden client (`src/frontend/lib/eden.ts`), TanStack Query — copy the invalidation/mutation conventions from `src/core/project/client/hooks.ts`.
- Produces hooks used by Tasks 7–9: `useCafes()`, `useCafe(id)`, `useCreateCafe()`, `useUpdateCafe(id)`, `useSubmitCafe(id)`, `useReviewCafe(id)`, `useCafeProducts(cafeId)`, `useCreateProduct(cafeId)`, `useUpdateProduct(cafeId)`, `useReviewProduct()`, `useReviewQueue()`, `usePendingProducts()`. Query keys: `["cafes"]`, `["cafes", id]`, `["cafes", id, "products"]`, `["cafes", "review-queue"]`, `["products", "pending"]`; mutations invalidate the affected keys.

- [ ] **Step 1: Implement hooks** mirroring the project hooks file (open it first; reuse its response-unwrapping helper and error toasts).
- [ ] **Step 2: Verify** — `pnpm typecheck`
- [ ] **Step 3: Commit** — `git commit -m "feat(cafe): client hooks"`

---

### Task 7: Café owner panel UI

**Files:**
- Create: `src/app/(app)/cafe/page.tsx` — "my cafés" list + create button
- Create: `src/app/(app)/cafe/[cafeId]/page.tsx` — panel
- Create: `src/core/cafe/client/ui/cafe-form.tsx`
- Create: `src/core/cafe/client/ui/product-form.tsx`
- Create: `src/core/cafe/client/ui/product-list.tsx`
- Create: `src/core/cafe/client/ui/status-badge.tsx`
- Create: `src/core/cafe/server/api/routes/list-my-cafes.route.ts` (+ register in router, + `listMyCafesService` + `list-cafes-by-user.ts` repository joining `cafe_member`)

**Interfaces:**
- Consumes: Task 6 hooks, existing shadcn components (`src/frontend/components/ui/*`), `useTanstackForm` hook if that's what project forms use (check `src/frontend/hooks/use-tanstack-form.ts` + `project-form.tsx` and copy the pattern).
- Produces: owner flow — create café → fill profile (cafe-form: name, description, address, district, contactPhone, ruc, photoUrl) → add products (product-form: name, description, type select, priceSoles, cogsSoles; inline warning text when type=reward and Number(cogsSoles) > 3: `"COGS sobre S/3 deja margen directo negativo (objetivo ≤ S/3)"`) → submit for review button (disabled with gap list when incomplete; render 422 `targets` as the checklist) → status badge (`draft` gray, `submitted` amber, `approved` green, `rejected` red + reviewNote shown).

- [ ] **Step 1: Build components** following `project-form.tsx` conventions (TanStack Form + zod validators + shadcn inputs). Product list is a simple table (`<Table>` from ui), not the heavy data-table framework — YAGNI for MVP catalog sizes.
- [ ] **Step 2: Wire pages** — `(app)` layout already enforces session; owner check happens server-side per request anyway.
- [ ] **Step 3: Manual verification** — with dev server: create café → gaps shown → complete → submit → badge `submitted`. States: loading spinners, error toasts (spec §19 obligatory states).
- [ ] **Step 4: Verify + commit**

```bash
pnpm check:fix && pnpm typecheck && pnpm test
git add src/app/\(app\)/cafe src/core/cafe/client src/core/cafe/server
git commit -m "feat(cafe): owner panel with onboarding and catalog"
```

---

### Task 8: Ops console + consumer discovery

**Files:**
- Create: `src/app/(app)/ops/page.tsx` — review queues
- Create: `src/core/cafe/client/ui/review-card.tsx`
- Create: `src/app/(app)/discover/page.tsx` — public approved café list
- Modify: `src/app/(app)/layout.tsx` nav — add links (Cafés, Descubrir; Ops link only when `session.user.isOps`)

**Interfaces:**
- Consumes: Task 6 hooks (`useReviewQueue`, `usePendingProducts`, `useReviewCafe`, `useReviewProduct`, `useCafes`).
- Produces: `/ops` — two sections: "Cafés por revisar" (each card: profile fields + Aprobar / Rechazar with required note on reject) and "Productos por revisar" (name, type, price, cogs + same actions). `/discover` — grid of approved cafés (name, district, description, photo) linking to a café detail with its approved products.

- [ ] **Step 1: Build ops page** — non-ops users hitting `/ops` get the 403 from the API; render it as "No autorizado". Reject flow: textarea for `reviewNote`, disabled submit until non-empty (mirrors server rule).
- [ ] **Step 2: Build discover page** — public data only (hook hits public endpoints; verify no `ruc`/`contactPhone` in rendered payload).
- [ ] **Step 3: Manual verification** — as `demo-ops@punch.pe`: approve the seeded `submitted` café; it appears in `/discover`.
- [ ] **Step 4: Verify + commit**

```bash
pnpm check:fix && pnpm typecheck && pnpm test
git add src/app/\(app\)/ops src/app/\(app\)/discover src/core/cafe/client src/app/\(app\)/layout.tsx
git commit -m "feat(cafe): ops review console and consumer discovery"
```

---

### Task 9: Seed — 4 cafés from master spec §30

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: 3a `DEMO_ACCOUNTS` + seed structure; Task 1 tables.
- Produces: idempotent seed of cafés + memberships + products.

- [ ] **Step 1: Extend seed** with a `SEED_CAFES` array and insertion keyed by slug (skip if slug exists):

```ts
const SEED_CAFES = [
    {
        slug: "brujula-cafe",
        name: "Brújula Café",
        ownerEmail: "brujula@punch.pe",
        district: "Miraflores",
        address: "Av. Larco 345, Miraflores",
        description: "Café de especialidad frente al parque.",
        status: "approved" as const,
        products: [
            { name: "Espresso", type: "emission", priceSoles: "8.00" },
            { name: "Latte", type: "emission", priceSoles: "12.00" },
            { name: "Cappuccino clásico", type: "reward", priceSoles: "11.00", cogsSoles: "2.80" },
        ],
    },
    {
        slug: "patio-9",
        name: "Patio 9",
        ownerEmail: "patio9@punch.pe",
        district: "Barranco",
        address: "Jr. Unión 910, Barranco",
        description: "Patio interior, tuestes locales.",
        status: "approved" as const,
        products: [
            { name: "Americano", type: "emission", priceSoles: "9.00" },
            { name: "Flat white", type: "emission", priceSoles: "13.00" },
            { name: "Filtrado V60", type: "reward", priceSoles: "12.00", cogsSoles: "3.00" },
        ],
    },
    {
        slug: "nube-tostada",
        name: "Nube Tostada",
        ownerEmail: "nube@punch.pe",
        district: "San Isidro",
        address: "Calle Los Pinos 120, San Isidro",
        description: "Micro-tostaduría de barrio.",
        status: "approved" as const,
        products: [
            { name: "Espresso doble", type: "emission", priceSoles: "10.00" },
            { name: "Cold brew", type: "reward", priceSoles: "12.00", cogsSoles: "2.50" },
        ],
    },
    {
        slug: "esquina-sur",
        name: "Esquina Sur",
        ownerEmail: "esquinasur@punch.pe",
        district: "Surquillo",
        address: "Av. Angamos Este 550, Surquillo",
        description: "Esquina de barrio, café honesto.",
        status: "approved" as const,
        products: [
            { name: "Café pasado", type: "emission", priceSoles: "7.00" },
            { name: "Cortado", type: "reward", priceSoles: "9.00", cogsSoles: "2.20" },
        ],
    },
    {
        slug: "quinto-cafe-demo",
        name: "Quinto Café (en revisión)",
        ownerEmail: "demo-consumer@punch.pe",
        district: "Lince",
        address: "Av. Arequipa 2020, Lince",
        description: "Café de demo para la cola de ops.",
        status: "submitted" as const,
        products: [
            { name: "Espresso", type: "emission", priceSoles: "8.50" },
        ],
    },
] as const;
```

For each: insert `cafe` (with `onboardingStatus: c.status`, `contactPhone: "+51 900 000 000"`, `ruc: "20600000001"` variant per café), `cafeMember` owner row for `ownerEmail`'s user id (`onConflictDoNothing`), products with `approvalStatus: c.status === "approved" ? "approved" : "pending"`. All inserts direct via drizzle (server-side seed bypasses API on purpose — states like `approved` aren't reachable via one API call).

- [ ] **Step 2: Run twice** — `pnpm db:seed && pnpm db:seed`
Expected: second run all `=` skips; verification block still passes.

- [ ] **Step 3: Full verification + commit**

Run: `pnpm check:fix && pnpm typecheck && pnpm test`
Manual: demo login as Café Brújula → panel shows approved café + products; as Ops → queue shows Quinto Café; as consumer → `/discover` shows 4 cafés.

```bash
git add scripts/seed.ts
git commit -m "feat(cafe): seed four §30 cafés with catalogs and review-queue demo"
```

---

## Acceptance checklist (spec 3b)

- [ ] Reward > S/12 rejected in zod, DB check, and update path (tests).
- [ ] Onboarding transitions enforced; invalid → 409 (tests).
- [ ] Submit with missing fields → 422 listing gaps (tests + UI checklist).
- [ ] Reject requires actionable note (zod refine + UI).
- [ ] Public endpoints never expose `ruc`/`contactPhone`/`reviewNote`.
- [ ] Economic product edits reset approval to pending (tests).
- [ ] Ops console approves/rejects cafés and products.
- [ ] `/discover` lists 4 seeded cafés; seed idempotent.
