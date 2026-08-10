# NetworkFund Runtime (slice mínimo demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el ciclo del fondo común: referencias verificables automáticas on-chain, reparto por epoch 40/30/20/10 y claim prorrateado al owner del café, demostrable en minutos.

**Architecture:** El contrato `NetworkFund.sol` ya está desplegado y recibe S/5 por plan/pack desde PlanManager. Se añade: un job relayer `referral_record` encolado automáticamente cuando se confirman vouchers de campaña y transiciones de crawl; dos scripts CLI (`chain:fund-epoch`, `chain:close-epoch`) que operan el epoch como owner local; y un card en el panel café con lecturas chain directas (viem). Cero tablas de proyección nuevas; única migración: valor de enum.

**Tech Stack:** TypeScript, Next.js, Elysia/Eden, Drizzle + PostgreSQL, viem, Vitest, Anvil/Foundry.

## Global Constraints

- Epoch id = `YYYYMM` UTC (ej. `202608`), tipo `number`.
- Fuentes de referencia MVP: solo crawl A→B cumplida y campaña (crédito al `sourceCafeId` de la campaña = café que la creó). Nada de "recomendación en app".
- `referralId` on-chain = `keccak256(toBytes(referralKey))`; `idempotencyKey` del job = `referral:${referralKey}`.
- `referralKey` campaña = `voucher:${chainCampaignId}:${userAddressLowercase}`; crawl = `crawl:${consumerUserId}:${chainCafeA}:${chainCafeB}`.
- Idempotencia doble obligatoria: unique `idempotency_key` en DB + `ReferralIdUsed` tratado como éxito.
- Ciclo de epoch manual (scripts), sin cron.
- El card de UI lee chain directo; textos en español; estados cargando/error/vacío.
- No tocar `.env`; no commitear `src/core/chain/addresses.local.json`; no molestar Anvil ajeno (puerto 8545 solo si es el propio del entorno).
- Verificación integración: DB fresca, `DATABASE_SSL=false`, `PUNCH_RUN_INTEGRATION=1`, vitest serial `--fileParallelism=false`. Live además `PUNCH_RUN_LIVE_CHAIN=1 CONSUMER_CHAIN_MODE=local` y Anvil propio.
- Los cleanups de tests live NUNCA borran filas respaldadas por eventos on-chain (lección commit `f4ffb06`).
- TDD estricto: test primero, verlo fallar, implementar, verlo pasar, commit.

---

### Task 1: Migración 0018 — kind `referral_record`

**Files:**
- Modify: `src/server/drizzle/schemas/purchase-schema.ts:77-127`
- Create: `drizzle/0018_*.sql` (generado)
- Test: `src/server/drizzle/__tests__/referral-job-schema.integration.test.ts`

**Interfaces:**
- Produces: valor `"referral_record"` en `relayerJobKind` (y por tanto en `RelayerJobKind`).

- [ ] **Step 1: Test de integración que falla**

```ts
// src/server/drizzle/__tests__/referral-job-schema.integration.test.ts
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";

const integration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!integration);

describeIntegration("referral_record relayer job schema", () => {
    installIntegrationDbMutex();
    const created: string[] = [];

    afterEach(async () => {
        for (const id of created.splice(0)) {
            await db.delete(relayerJob).where(eq(relayerJob.id, id));
        }
    });

    it("accepts a referral_record job with no order and no redemption request", async () => {
        const [row] = await db
            .insert(relayerJob)
            .values({
                kind: "referral_record",
                idempotencyKey: `referral:test:${crypto.randomUUID()}`,
                payload: { epoch: 202608, originCafeId: 1, referralId: "0xabc" },
            })
            .returning({ id: relayerJob.id, kind: relayerJob.kind });
        created.push(row.id);
        expect(row.kind).toBe("referral_record");
    });
});
```

Nota: si `installIntegrationDbMutex` vive en otra ruta, copiar el import exacto de `src/core/chain/server/indexer/__tests__/redemption-projection.integration.test.ts`.

- [ ] **Step 2: Verificar que falla** — `PUNCH_RUN_INTEGRATION=1 DATABASE_URL=<db fresca> DATABASE_SSL=false pnpm exec vitest run src/server/drizzle/__tests__/referral-job-schema.integration.test.ts` → falla con `invalid input value for enum relayer_job_kind`.

- [ ] **Step 3: Editar schema.** En `purchase-schema.ts`: añadir `"referral_record"` al final del array de `relayerJobKind`; en el `check("relayer_job_target_check", ...)`, añadir `'referral_record'` a la lista `in ('campaign_create', ..., 'voucher_redeem', 'referral_record')` (la rama que exige `orderId IS NULL AND redemptionRequestId IS NULL`).

- [ ] **Step 4: Generar migración** — `pnpm db:generate`. Revisar el SQL generado: debe recrear el enum (patrón de `drizzle/0017_high_nighthawk.sql`: DROP CONSTRAINT → RENAME TYPE → CREATE TYPE con el valor nuevo → ALTER COLUMN USING → DROP old TYPE → ADD CONSTRAINT). Ejecutar `pnpm exec drizzle-kit check`.

- [ ] **Step 5: Migrar la DB de prueba y verificar verde** — `DATABASE_URL=<db fresca> DATABASE_SSL=false pnpm exec tsx --env-file=.env scripts/migrate.ts` y re-correr el test del Step 1 → PASS.

- [ ] **Step 6: Commit** — `git add -A drizzle src/server/drizzle && git commit -m "feat(fund): add referral_record relayer job kind"`

### Task 2: Módulo network-fund — epoch helper y enqueue

**Files:**
- Create: `src/core/chain/server/network-fund/epoch.ts`
- Create: `src/core/chain/server/network-fund/referrals.ts`
- Test: `src/core/chain/server/network-fund/__tests__/epoch.test.ts`
- Test: `src/core/chain/server/network-fund/__tests__/referrals.integration.test.ts`

**Interfaces:**
- Produces: `currentEpoch(date?: Date): number`; `referralKeyForVoucher(chainCampaignId: number, userAddress: string): string`; `referralKeyForCrawl(consumerUserId: string, chainCafeA: number, chainCafeB: number): string`; `enqueueReferralRecord(tx: JobTransaction, input: { originChainCafeId: number; referralKey: string; epoch?: number }): Promise<void>`.
- Consumes: `enqueueJob` de `@/core/chain/server/relayer/job-repository`; kind `referral_record` (Task 1).

- [ ] **Step 1: Test unit epoch (falla)**

```ts
// src/core/chain/server/network-fund/__tests__/epoch.test.ts
import { describe, expect, it } from "vitest";
import { currentEpoch } from "../epoch";

describe("currentEpoch", () => {
    it("formats YYYYMM in UTC", () => {
        expect(currentEpoch(new Date("2026-08-10T23:59:59Z"))).toBe(202608);
    });
    it("uses UTC at month boundaries", () => {
        expect(currentEpoch(new Date("2026-08-31T23:59:59Z"))).toBe(202608);
        expect(currentEpoch(new Date("2026-09-01T00:00:00Z"))).toBe(202609);
        expect(currentEpoch(new Date("2026-12-15T12:00:00Z"))).toBe(202612);
        expect(currentEpoch(new Date("2027-01-01T00:00:00Z"))).toBe(202701);
    });
});
```

- [ ] **Step 2: Verificar fallo** — `pnpm exec vitest run src/core/chain/server/network-fund/__tests__/epoch.test.ts` → módulo no existe.

- [ ] **Step 3: Implementar epoch.ts**

```ts
// src/core/chain/server/network-fund/epoch.ts
export function currentEpoch(date: Date = new Date()): number {
    return date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);
}
```

- [ ] **Step 4: Verde** — re-correr Step 2.

- [ ] **Step 5: Test integración enqueue (falla)**

```ts
// src/core/chain/server/network-fund/__tests__/referrals.integration.test.ts
import { eq, like } from "drizzle-orm";
import { keccak256, toBytes } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/drizzle/db";
import { relayerJob } from "@/server/drizzle/schemas/purchase-schema";
import { installIntegrationDbMutex } from "@/test/integration-db-mutex";
import {
    enqueueReferralRecord,
    referralKeyForCrawl,
    referralKeyForVoucher,
} from "../referrals";

const integration = process.env.PUNCH_RUN_INTEGRATION === "1";
const describeIntegration = describe.skipIf(!integration);

describeIntegration("enqueueReferralRecord", () => {
    installIntegrationDbMutex();
    const suffix = crypto.randomUUID();

    afterEach(async () => {
        await db
            .delete(relayerJob)
            .where(like(relayerJob.idempotencyKey, `referral:%${suffix}%`));
    });

    it("enqueues exactly one job per referral key", async () => {
        const key = referralKeyForVoucher(7, `0xAbC${suffix}`);
        await db.transaction(async (tx) => {
            await enqueueReferralRecord(tx, {
                originChainCafeId: 3,
                referralKey: key,
                epoch: 202608,
            });
            await enqueueReferralRecord(tx, {
                originChainCafeId: 3,
                referralKey: key,
                epoch: 202608,
            });
        });
        const rows = await db
            .select()
            .from(relayerJob)
            .where(eq(relayerJob.idempotencyKey, `referral:${key}`));
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe("referral_record");
        expect(rows[0].payload).toMatchObject({
            epoch: 202608,
            originCafeId: 3,
            referralId: keccak256(toBytes(key)),
        });
    });

    it("normalizes voucher keys to lowercase addresses and builds crawl keys", () => {
        expect(referralKeyForVoucher(7, "0xABcD")).toBe("voucher:7:0xabcd");
        expect(referralKeyForCrawl(`u-${suffix}`, 1, 2)).toBe(
            `crawl:u-${suffix}:1:2`,
        );
    });
});
```

- [ ] **Step 6: Verificar fallo, implementar referrals.ts**

```ts
// src/core/chain/server/network-fund/referrals.ts
import "server-only";

import { keccak256, toBytes } from "viem";
import {
    enqueueJob,
    type JobTransaction,
} from "@/core/chain/server/relayer/job-repository";
import { currentEpoch } from "./epoch";

export function referralKeyForVoucher(
    chainCampaignId: number,
    userAddress: string,
): string {
    return `voucher:${chainCampaignId}:${userAddress.toLowerCase()}`;
}

export function referralKeyForCrawl(
    consumerUserId: string,
    chainCafeA: number,
    chainCafeB: number,
): string {
    return `crawl:${consumerUserId}:${chainCafeA}:${chainCafeB}`;
}

export async function enqueueReferralRecord(
    tx: JobTransaction,
    input: {
        originChainCafeId: number;
        referralKey: string;
        epoch?: number;
    },
): Promise<void> {
    await enqueueJob(tx, {
        kind: "referral_record",
        idempotencyKey: `referral:${input.referralKey}`,
        payload: {
            epoch: input.epoch ?? currentEpoch(),
            originCafeId: input.originChainCafeId,
            referralId: keccak256(toBytes(input.referralKey)),
        },
    });
}
```

- [ ] **Step 7: Verde ambos tests.** `server-only` está stubbeado en vitest (alias en `vitest.config.ts`), no estorba.

- [ ] **Step 8: Commit** — `git commit -m "feat(fund): add epoch helper and referral enqueue"`

### Task 3: Ganchos automáticos — campaña y crawl

**Files:**
- Modify: `src/core/chain/server/indexer/campaign-projection.ts` (función `applyUnlocked`, tras el insert del voucher)
- Modify: `src/core/punch/server/repository/chain-purchase-effects.ts` (rama normal de crawl, tras `advanceCrawlProgress`)
- Test: `src/core/chain/server/indexer/__tests__/campaign-referral.integration.test.ts`
- Test: `src/core/punch/server/repository/__tests__/crawl-referral.integration.test.ts`

**Interfaces:**
- Consumes: `enqueueReferralRecord`, `referralKeyForVoucher`, `referralKeyForCrawl` (Task 2).
- Contexto: en `applyUnlocked`, `findCampaign` ya devuelve `{ requestId?/id, cafeId }` del campaign app; el `sourceCafeId` on-chain es el café creador = `campaign.cafeId` → su `chainCafeId` se lee de la tabla `cafe`. En `applyChainPurchaseEffects`, la transición A→B está en la rama `if (!nextStep || nextStep.cafeId !== input.cafeId) return;` — A = último elemento de `progress.completedCafeIds` ANTES de push, B = `input.cafeId`.

- [ ] **Step 1: Test integración campaña (falla).** Modelar sobre `campaign-projection.integration.test.ts` existente (fixtures user/cafe/campaign + `applyCampaignEvent` con evento `VoucherUnlocked`). Asserts:

```ts
// núcleo del test — fixture igual al patrón existente del archivo vecino
const jobs = await db
    .select()
    .from(relayerJob)
    .where(
        eq(
            relayerJob.idempotencyKey,
            `referral:voucher:${chainCampaignId}:${walletAddress.toLowerCase()}`,
        ),
    );
expect(jobs).toHaveLength(1);
expect(jobs[0].payload).toMatchObject({
    originCafeId: fixtureChainCafeId,
});
// replay del MISMO evento (mismo block/txIndex/logIndex) no duplica:
// aplicar dos veces y re-assert length 1
```

El café fixture debe tener `chainCafeId` numérico. Cleanup: borra el job por idempotencyKey; NO borra filas de proyección que otros tests compartan (usar sufijos propios).

- [ ] **Step 2: Verificar fallo** (0 jobs). Implementar en `applyUnlocked`, después del bloque `insert(consumerVoucher)` y antes del `return`:

```ts
const [cafeRow] = await tx
    .select({ chainCafeId: cafe.chainCafeId })
    .from(cafe)
    .where(eq(cafe.id, appCampaign.cafeId));
if (cafeRow?.chainCafeId != null) {
    await enqueueReferralRecord(tx, {
        originChainCafeId: cafeRow.chainCafeId,
        referralKey: referralKeyForVoucher(chainCampaignId, userAddress),
    });
}
```

Import `cafe` de `@/server/drizzle/schemas/cafe-schema` (el archivo ya no lo importa; añadirlo). El enqueue va DENTRO del branch `if (updated.length === 0) return;` ya superado — es decir, solo cuando el evento avanzó la proyección; el replay exacto no re-encola (y si lo hiciera, el idempotencyKey lo frena).

- [ ] **Step 3: Verde test campaña.**

- [ ] **Step 4: Test integración crawl (falla).** Fixture: crawl activo de 3 cafés con `chainCafeId` 11/12/13 (sufijo propio), consumer propio. Llamar `applyChainPurchaseEffects` tres veces (una por café en orden). Asserts: existen exactamente 2 jobs `referral_record` con claves `referral:crawl:<consumerId>:11:12` (originCafeId 11) y `referral:crawl:<consumerId>:12:13` (originCafeId 12); primera compra (sin café previo) no encola nada; re-aplicar la segunda compra no duplica.

- [ ] **Step 5: Verificar fallo. Implementar en `chain-purchase-effects.ts`**, dentro de la rama normal, después de `advanceCrawlProgress` (usa el array PRE-push para A):

```ts
const previousCafeId =
    progress.completedCafeIds[progress.completedCafeIds.length - 1];
if (previousCafeId) {
    const [previousCafe] = await tx
        .select({ chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .where(eq(cafe.id, previousCafeId));
    const [currentCafe] = await tx
        .select({ chainCafeId: cafe.chainCafeId })
        .from(cafe)
        .where(eq(cafe.id, input.cafeId));
    if (
        previousCafe?.chainCafeId != null &&
        currentCafe?.chainCafeId != null
    ) {
        await enqueueReferralRecord(tx, {
            originChainCafeId: previousCafe.chainCafeId,
            referralKey: referralKeyForCrawl(
                input.consumerUserId,
                previousCafe.chainCafeId,
                currentCafe.chainCafeId,
            ),
        });
    }
}
```

Import `cafe` de `@/server/drizzle/schemas/cafe-schema` y helpers de Task 2. La idempotencia del replay la da `recordEffect` (onConflictDoNothing → `if (!effect) return;` corta antes) más el idempotencyKey.

- [ ] **Step 6: Verde test crawl. Correr también los integration tests vecinos** (`chain-purchase-effects.integration.test.ts`, `campaign-projection.integration.test.ts`) para no romper nada.

- [ ] **Step 7: Commit** — `git commit -m "feat(fund): enqueue verified referrals from campaign and crawl confirmations"`

### Task 4: parse-revert + handler relayer `referral-record`

**Files:**
- Modify: `src/core/chain/server/relayer/parse-revert.ts` (errorAbis + codes + mapping)
- Create: `src/core/chain/server/relayer/handlers/referral-record.ts`
- Modify: `src/core/chain/server/relayer/handlers/registry.ts`
- Test: `src/core/chain/server/relayer/handlers/__tests__/referral-record.test.ts`
- Test: modificar `src/core/chain/server/relayer/__tests__/parse-revert.test.ts`

**Interfaces:**
- Consumes: payload `{ epoch: number; originCafeId: number; referralId: 0x-hex }` (Task 2); tipos `JobHandler`, `JobContext` de `./types`.
- Produces: handler registrado para kind `referral_record`; codes nuevos `referral_id_used`, `not_referral_recorder`, `epoch_finalized`, `referral_proof_required`.

- [ ] **Step 1: Test parse-revert (falla).** En `parse-revert.test.ts` añadir casos: `ReferralIdUsed` → `referral_id_used`, `NotReferralRecorder` → `not_referral_recorder`, `EpochFinalized` → `epoch_finalized` (codificar el error con `encodeErrorResult` sobre `abis.networkFund` como hacen los casos existentes).

- [ ] **Step 2: Implementar en parse-revert.ts:** añadir `...abis.networkFund` a `errorAbis`; añadir los 4 codes al union `RevertCode`; mapear en el switch/tabla los nombres `ReferralIdUsed`, `NotReferralRecorder`, `EpochFinalized`, `ReferralProofRequired`. `CafeNotOperational` ya existe (`cafe_not_operational`) — verificar que decodifica igual desde el ABI del fondo. Verde.

- [ ] **Step 3: Test handler (falla)**

```ts
// src/core/chain/server/relayer/handlers/__tests__/referral-record.test.ts
import { describe, expect, it } from "vitest";
import { referralRecordHandler } from "../referral-record";

const job = (payload: unknown) =>
    ({ id: "j1", payload }) as never;

describe("referralRecordHandler", () => {
    it("targets NetworkFund.recordReferralWithProof with exact args", async () => {
        const call = await referralRecordHandler.call(
            job({ epoch: 202608, originCafeId: 3, referralId: `0x${"ab".repeat(32)}` }),
            { addresses: { networkFund: "0xfund" } } as never,
        );
        expect(call.address).toBe("0xfund");
        expect(call.functionName).toBe("recordReferralWithProof");
        expect(call.args).toEqual([202608n, 3n, `0x${"ab".repeat(32)}`]);
    });

    it("signs as relayer and treats ReferralIdUsed as idempotent", () => {
        expect(referralRecordHandler.signer(job({}))).toEqual({
            kind: "relayer",
        });
        expect(
            referralRecordHandler.idempotentCodes?.has("referral_id_used"),
        ).toBe(true);
    });

    it("rejects malformed payloads", async () => {
        await expect(
            referralRecordHandler.call(job({ epoch: "x" }), {} as never),
        ).rejects.toThrow("invalid payload");
    });
});
```

- [ ] **Step 4: Implementar handler**

```ts
// src/core/chain/server/relayer/handlers/referral-record.ts
import { abis } from "@/core/chain/abis";
import type { JobHandler } from "./types";

type Payload = { epoch: number; originCafeId: number; referralId: string };

function payloadOf(job: { payload: unknown }): Payload {
    const value = job.payload as Partial<Payload>;
    if (
        typeof value?.epoch !== "number" ||
        !Number.isSafeInteger(value.epoch) ||
        typeof value?.originCafeId !== "number" ||
        !Number.isSafeInteger(value.originCafeId) ||
        typeof value?.referralId !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(value.referralId)
    ) {
        throw new Error("invalid payload");
    }
    return value as Payload;
}

export const referralRecordHandler: JobHandler = {
    kind: "referral_record",
    signer: () => ({ kind: "relayer" }),
    async call(job, ctx) {
        const payload = payloadOf(job);
        return {
            address: ctx.addresses.networkFund,
            abi: abis.networkFund,
            functionName: "recordReferralWithProof",
            args: [
                BigInt(payload.epoch),
                BigInt(payload.originCafeId),
                payload.referralId as `0x${string}`,
            ],
        };
    },
    idempotentCodes: new Set(["referral_id_used"]),
};
```

Registrar en `registry.ts`: `referral_record: referralRecordHandler`. Reverts permanentes (`not_referral_recorder`, `epoch_finalized`, `cafe_not_operational`) siguen la vía estándar del relayer (fallo permanente con `lastError` decodificado — razón accionable visible).

- [ ] **Step 5: Verde. Correr también `registry.test.ts`, `relayer.test.ts`, `parse-revert.test.ts` completos.**

- [ ] **Step 6: Commit** — `git commit -m "feat(fund): add referral_record relayer handler"`

### Task 5: Wiring — dev-chain y bootstrap repair

**Files:**
- Modify: `scripts/dev-chain.ts` (tras el bloque `setCampaignEscrow`, ~línea 178)
- Modify: `src/core/chain/server/bootstrap-local/service.ts` + su repository si aplica
- Test: modificar `src/core/chain/__tests__/dev-chain.test.ts`
- Test: modificar `src/core/chain/server/bootstrap-local/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `relayerAccount` ya derivado en dev-chain (`RELAYER_WALLET_INDEX ?? 0`); patrón de writes con `waitForWrite`.
- Produces: on-chain `NetworkFund.referralRecorder == relayer wallet` tras deploy y tras bootstrap repair.

- [ ] **Step 1: Test dev-chain (falla).** En `dev-chain.test.ts`, siguiendo el patrón de asserts existente del archivo, añadir caso: tras el deploy/wire, se llamó `setReferralRecorder` en `networkFund` con `relayerAccount.address`. (El test existente mockea/espía los writes; copiar ese mecanismo.)

- [ ] **Step 2: Implementar en dev-chain.ts** — mover la derivación de `relayerAccount` ANTES del bloque de wires del fondo si hace falta, y añadir:

```ts
await waitForWrite(
    pub,
    await wallet.writeContract({
        address: networkFund,
        abi: fundAbi,
        functionName: "setReferralRecorder",
        args: [relayerAccount.address],
    }),
    "set referral recorder",
);
```

- [ ] **Step 3: Verde dev-chain test.**

- [ ] **Step 4: Test bootstrap repair (falla).** En `bootstrap-local/__tests__/service.test.ts`: si el chain reporta `referralRecorder() != relayer`, el service emite el write `setReferralRecorder(relayer)` (vía deployer/owner, patrón de repairs existentes del service); si coincide, no escribe.

- [ ] **Step 5: Implementar repair en bootstrap-local** siguiendo el patrón de los repairs existentes (leer estado, comparar, escribir con el owner local, log una línea). Verde.

- [ ] **Step 6: Commit** — `git commit -m "feat(fund): wire referral recorder to relayer wallet"`

### Task 6: Operaciones de epoch + scripts CLI

**Files:**
- Create: `src/core/chain/server/network-fund/epoch-ops.ts`
- Create: `scripts/fund-epoch.ts`
- Create: `scripts/close-epoch.ts`
- Modify: `package.json` (scripts `chain:fund-epoch`, `chain:close-epoch`)
- Test: `src/core/chain/server/network-fund/__tests__/epoch-ops.test.ts`

**Interfaces:**
- Produces: `fundCurrentEpoch(deps, epoch?): Promise<{ epoch: number; amount: bigint } | { epoch: number; amount: 0n }>`; `closeEpoch(deps, epoch?): Promise<{ epoch: number; claims: { chainCafeId: number; referrals: number; amount: bigint }[] }>` donde `deps = { pub, wallet, addresses }` (viem clients + AddressMap). Scripts = wrappers finos.
- Consumes: `currentEpoch` (Task 2); ABI `abis.networkFund`; owner local = deployer mnemonic Anvil (`test test ... junk`, index 0) igual que `scripts/dev-chain.ts`.

- [ ] **Step 1: Test unit epoch-ops (falla).** Con `pub`/`wallet` mockeados (objetos con `readContract`/`writeContract`/`waitForTransactionReceipt` espiados):
  - `fundCurrentEpoch`: `freeBalance` 0 → no escribe, retorna amount 0n; `freeBalance` 10_000_000n → llama `fundEpoch(epoch, 10_000_000n)`.
  - `closeEpoch`: epoch no finalizado → llama `finalizeOriginEpoch`; para cafés operacionales con `referrals(epoch, cafeId) > 0` (mock: café 1 → 2 refs, café 2 → 0) llama `claimOriginCredit(epoch, 1)` y NO para el 2; claim que revierte `OriginAlreadyClaimed` se salta sin abortar (mock de write que lanza; assert que el resultado lo reporta como saltado y sigue).
  - Cómo enumerar cafés: leer de la DB los `cafe.chainCafeId` no nulos (inyectar `listChainCafeIds: () => Promise<number[]>` en deps para no acoplar el test a Drizzle).

- [ ] **Step 2: Implementar epoch-ops.ts.** `fundCurrentEpoch`: `freeBalance()` → si 0 retorna; si no, `fundEpoch(epoch, amount)` con el wallet owner y espera receipt. `closeEpoch`: `getEpoch(epoch)` → si `!finalized`, `finalizeOriginEpoch(epoch)`; luego por cada `chainCafeId` de `deps.listChainCafeIds()`: `referrals(epoch, id)` → si `> 0` y `!originClaimed(epoch, id)`, `claimOriginCredit(epoch, id)` en try/catch (revert → registrar `skipped` y continuar); acumula `{ chainCafeId, referrals, amount }` con `pendingOriginCredit` leído ANTES del claim. Verde.

- [ ] **Step 3: Scripts.** `scripts/fund-epoch.ts` y `scripts/close-epoch.ts`: parsean `--epoch YYYYMM` opcional (default `currentEpoch()`), construyen clients viem (`CHAIN_RPC_URL ?? http://127.0.0.1:8545`, chain foundry, deployer mnemonic Anvil index 0 — patrón de `scripts/dev-chain.ts`), `listChainCafeIds` vía Drizzle (`select chainCafeId from cafe where chainCafeId is not null`), llaman la op e imprimen resultado legible (epoch, montos por bucket vía `getEpoch`, claims por café). En `package.json`:

```json
"chain:fund-epoch": "node --conditions=react-server --import tsx --env-file=.env scripts/fund-epoch.ts",
"chain:close-epoch": "node --conditions=react-server --import tsx --env-file=.env scripts/close-epoch.ts",
```

- [ ] **Step 4: Verde unit tests; typecheck.** (El ejercicio end-to-end de los scripts ocurre en Task 8.)

- [ ] **Step 5: Commit** — `git commit -m "feat(fund): add manual epoch fund/close operations and CLI"`

### Task 7: Card "Fondo común" en panel café

**Files:**
- Create: `src/core/cafe/server/services/get-cafe-fund-service.ts`
- Create: `src/core/cafe/server/api/routes/get-cafe-fund.route.ts` (montarla donde se montan las rutas cafe existentes; ver `src/server/router.ts` y el router de cafe)
- Modify: `src/core/cafe/client/hooks.ts` (añadir `useCafeFund`)
- Modify: `src/app/(app)/(workspace)/cafe/[cafeId]/page.tsx` (card nueva)
- Test: `src/core/cafe/server/services/__tests__/get-cafe-fund-service.test.ts`
- Test: modificar `src/app/(app)/(workspace)/cafe/[cafeId]/__tests__/` (test de página existente si lo hay; si no, crear `fund-card.test.tsx` siguiendo el patrón de `campaigns-page.test.tsx`)

**Interfaces:**
- Produces: `GET /cafe/:cafeId/fund` → `{ epoch: number; referrals: number; pendingCreditMpen: string; estimated: boolean; buckets: { origin: string; acquisition: string; crawl: string; contingency: string } }` (bigints serializados como string, patrón de `list-cafe-campaigns.route.ts`).
- Consumes: `requireCafeRole(userId, cafeId, ["owner"])`; `currentEpoch()`; lecturas viem `referrals(epoch, chainCafeId)`, `pendingOriginCredit(epoch, chainCafeId)`, `getEpoch(epoch)` sobre `abis.networkFund` en `getAddresses().networkFund`.

- [ ] **Step 1: Test service (falla).** Mock del reader chain (inyectar `reader: { readContract }` en deps del service). Casos: (1) epoch no finalizado con refs 2, originPool 4_000_000n, totalReferrals 4 → `pendingCreditMpen: "2000000"`, `estimated: true`; (2) finalizado → usa `pendingOriginCredit` directo, `estimated: false`; (3) `totalReferrals` 0 → pending "0"; (4) café sin `chainCafeId` → error 409 conflict; (5) usuario no owner → propaga 403 de `requireCafeRole`.

- [ ] **Step 2: Implementar service.** Firma: `getCafeFundService(userId, cafeId, deps?)`. Lee `cafe.chainCafeId` de la DB; construye reader default con `createPublicClient({ chain: foundry, transport: http(process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545") })` (solo si no inyectado); `epoch = currentEpoch()`; `getEpoch(epoch)` → si `finalized` usa `pendingOriginCredit`, si no estima `originPool * refs / totalReferrals` (0n si `totalReferrals === 0n`). Retorna buckets del struct. Verde.

- [ ] **Step 3: Ruta + hook.** Ruta clonando el patrón exacto de `list-cafe-campaigns.route.ts` (authed, zod params/response, `errorToResponse`). Montarla junto a las rutas cafe en el router correspondiente. Hook `useCafeFund(cafeId)` clonando `useCafeCampaigns` (queryKey `["cafe-fund", cafeId]`, `refetchInterval: 5000`, `enabled: Boolean(cafeId)`).

- [ ] **Step 4: Card UI (test primero).** Test de página: con la query mockeada devolviendo `{ epoch: 202608, referrals: 3, pendingCreditMpen: "600000", estimated: true, buckets: {...} }` renderiza "Fondo común", "3 referencias", "S/0.60" y la marca "estimado"; con 0 referencias renderiza "Aún sin referencias este mes". Implementar card en `page.tsx`: título "Fondo común", línea referencias del mes, línea "Crédito de origen: S/X.XX" (+ sufijo " (estimado)" si `estimated`), cuatro buckets con S/ (`Number(v) / 1_000_000` con 2 decimales — mPEN base 1e6 = S/1, mismo divisor que el resto del panel), estados loading/error/empty. Español, sin exponer direcciones ni claves.

- [ ] **Step 5: Verde tests UI + service; `pnpm typecheck` y biome sobre archivos tocados.**

- [ ] **Step 6: Commit** — `git commit -m "feat(fund): show common fund card in cafe panel"`

### Task 8: Live journey + verificación final

**Files:**
- Create: `src/core/chain/server/__tests__/network-fund-journey.live.test.ts`
- Test: es el deliverable.

**Interfaces:**
- Consumes: todo lo anterior; patrón de `campaign-journey.live.test.ts` (gates `PUNCH_RUN_INTEGRATION=1 && PUNCH_RUN_LIVE_CHAIN=1`, `CONSUMER_CHAIN_MODE=local`, fixture consumer propio vía `assignWallet`, `drainRelayerAndIndexer`, cleanup que conserva filas respaldadas por chain); `fundCurrentEpoch`/`closeEpoch` de Task 6 llamadas como funciones (no shell).

- [ ] **Step 1: Escribir el live test.** `describeLive("live network fund journey")`, epoch fijo de prueba `--epoch` distinto al corriente NO: usar `currentEpoch()` real. Flujo:
  1. Fixture: consumer nuevo (patrón `assignWallet` de campaign-journey), café esquina-sur con campaña propia (crear/fund/publish como campaign-journey, `sourceCafeId` = esquina-sur).
  2. `before`: leer `freeBalance()` del fondo (los seeds de plan payment pueden haber dejado saldo; el test trabaja con deltas, nunca asume 0).
  3. Compra confirmada del consumer en esquina-sur → `drainRelayerAndIndexer()` → assert: job `referral_record` confirmado y `referrals(epoch, chainCafeId)` on-chain subió en 1.
  4. `fundCurrentEpoch(...)` → assert: buckets del epoch suben exactamente 40/30/20/10 del monto (con el resto de división en contingencia; comparar `origin + acquisition + crawl + contingency == amount`).
  5. Owner mPEN balance antes → `closeEpoch(...)` → assert: balance del owner sube exactamente `originPool × refs / totalReferrals` para su café y `originClaimed` es true.
  6. Re-ejecutar `closeEpoch` → no revienta, claims reportados como saltados (idempotencia).
  Cleanup: SOLO desactivar la campaña creada y restaurar estados demo (patrón exacto del afterAll de `campaign-journey.live.test.ts` post-f4ffb06); nada respaldado por chain se borra.

- [ ] **Step 2: Correr el ciclo live completo en estado fresco** (Anvil propio, puerto libre ≠ 8545 si hay peer):

```bash
# DB fresca punch_verify_fund + anvil propio + deploy + bootstrap + seed-history
PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1 CONSUMER_CHAIN_MODE=local \
  pnpm exec vitest run --fileParallelism=false src/core/chain/server/__tests__/
```

Los 4 suites previos + el nuevo deben pasar juntos (redemption exige `chain:seed-history` previo — mismo setup que el ciclo documentado).

- [ ] **Step 3: Gates completos** — suite serial gated completa (`PUNCH_RUN_INTEGRATION=1`, DB fresca migrada 0000→0018), `pnpm typecheck`, `pnpm exec drizzle-kit check`, biome sobre archivos tocados, build producción si hay tiempo.

- [ ] **Step 4: Commit** — `git commit -m "test(fund): prove full network fund cycle on live chain"`
