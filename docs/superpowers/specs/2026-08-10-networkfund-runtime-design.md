# NetworkFund Runtime (slice mínimo demo) — Design

Fecha: 2026-08-10
Estado: aprobado en brainstorming (sesión principal)
Spec maestra: §11 (fondo común), §12 (campañas), §13, §16 (`NetworkFund`)

## Objetivo

Cerrar el ciclo de valor del fondo común para la demo de hackathon: los S/5
por plan/pack que PlanManager ya transfiere on-chain al `NetworkFund` deben
poder repartirse por epoch (40/30/20/10), acumular referencias verificables
por café, y pagarse como crédito de origen prorrateado al owner del café —
todo demostrable en minutos, con control determinista.

El contrato `NetworkFund.sol` ya está completo y desplegado en el flujo
local (buckets, `recordReferralWithProof` idempotente por `referralId`,
`finalizeOriginEpoch`, `claimOriginCredit` permissionless, crawl pool →
CampaignEscrow). Esta pieza es 100% runtime backend + un card de UI.

## Decisiones (con el usuario)

1. **Fuentes de referencia MVP:** solo (a) transición crawl A→B cumplida y
   (b) campaña con `sourceCafeId`. "Recomendación en app" queda post-MVP.
2. **Momento de registro:** campaña → al confirmarse `VoucherUnlocked` en
   el indexer (adquisición verificada por ConsumptionLog). Crawl → al
   confirmarse el paso que agrega el café B teniendo paso previo A.
3. **Ciclo de epoch:** manual/determinista vía scripts CLI (demo en vivo),
   sin cron. Registro de referencias sí es automático (por evento).
4. **Epoch id:** `YYYYMM` en UTC (ej. `202608`).
5. **Sin proyecciones nuevas:** el card de UI lee chain directo con viem.
   Única migración: valor nuevo de enum para el relayer job.

## Alcance

### Incluye

- `setReferralRecorder(relayerWallet)` en bootstrap-local (deploy y repair).
- Encolado automático de jobs `referral_record` desde los puntos donde el
  indexer/efectos confirman voucher de campaña y paso de crawl.
- Handler relayer `referral-record` → `recordReferralWithProof`.
- Scripts `chain:fund-epoch` y `chain:close-epoch`.
- Card "Fondo común" en el panel del café (lecturas chain directas).
- Migración Drizzle 0018: enum `relayer_job_kind` + check constraint.
- Tests unit, integración y live journey.

### No incluye (post-hackathon)

- Cron/scheduler mensual.
- Recomendación en app.
- `releaseUnclaimedOrigin` y `withdrawBucket` fuera del contrato (sin UI).
- Proyecciones Postgres del fondo, consola ops, métricas.
- `allocateCampaignBudget` (crawl pool → CampaignEscrow) como flujo runtime.

## Diseño

### 1. Wiring del recorder

`bootstrap-local` (service + repair) llama `setReferralRecorder(relayer)`
si el valor on-chain difiere de la wallet del relayer. Owner local =
deployer (mnemonic Anvil), igual que el resto de ops de bootstrap.

### 2. Referencias automáticas

**Origen campaña.** En `campaign-projection.applyUnlocked` (indexer), tras
proyectar el voucher confirmado, encolar job relayer:

- `kind: "referral_record"`
- `idempotencyKey: "referral:voucher:<chainCampaignId>:<consumerAddress>"`
- payload: `{ epoch, originCafeId: <sourceCafeId de la campaña>,
  referralId: keccak256("voucher:<chainCampaignId>:<consumerAddress>") }`
- `epoch` se calcula al momento de encolar con la fecha actual UTC
  (`YYYYMM`); el registro y el evento se procesan en el mismo mes en la
  práctica y evita una lectura extra de bloque.

`sourceCafeId` es el café que creó/financió la campaña: el que invirtió en
adquirir el cliente recibe el crédito (consistente con contrato y §12.1).

**Origen crawl.** En el punto donde se confirma el efecto `crawl_step` que
agrega el café B al progreso del consumer con al menos un café previo A
(el paso anterior en la ruta), encolar job acreditando a A:

- `idempotencyKey: "referral:crawl:<consumerUserId>:<chainCafeA>:<chainCafeB>"`
- `referralId: keccak256("crawl:<consumerUserId>:<chainCafeA>:<chainCafeB>")`

Un crawl de 3 cafés produce 2 referencias (A→B acredita a A, B→C a B).

**Idempotencia doble:** el `idempotencyKey` único del job evita encolar dos
veces; el contrato rechaza `referralId` usado (`ReferralIdUsed`).

### 3. Handler relayer `referral-record`

Nuevo handler en `src/core/chain/server/relayer/handlers/referral-record.ts`
registrado en el registry existente. Firma con la wallet del relayer
(= `referralRecorder`). Comportamiento ante reverts decodificados:

- `ReferralIdUsed` → job confirmado (ya registrado; idempotencia).
- `CafeNotOperational`, `EpochFinalized` → fallo permanente con razón.
- `NotReferralRecorder` → fallo permanente con razón accionable
  ("recorder no configurado; correr chain:bootstrap-local"); el deploy
  local lo configura, así que solo ocurre por bootstrap incompleto.
- Errores ambiguos de broadcast → mismas reglas de recuperación que el
  resto de handlers (receipt por hash persistido).

### 4. Ciclo de epoch manual

**`pnpm chain:fund-epoch`** (`scripts/fund-epoch.ts`):
lee `freeBalance()`; si > 0, `fundEpoch(epochActual, freeBalance)` como
owner. Imprime buckets resultantes. Si 0, sale con mensaje claro.

**`pnpm chain:close-epoch`** (`scripts/close-epoch.ts`):
1. `finalizeOriginEpoch(epochActual)` (si no finalizado).
2. Para cada café operacional con `referrals(epoch, cafeId) > 0`:
   `claimOriginCredit(epoch, cafeId)` — permissionless, el script paga gas,
   el mPEN va siempre al owner que reporta el registry.
3. Imprime por café: referencias, monto reclamado.

Ambos aceptan `--epoch YYYYMM` opcional (default: mes actual UTC). El
resultado es visible sin trabajo extra: el balance mPEN del owner ya se
muestra en el panel café ("Saldo del propietario").

### 5. Card "Fondo común" (panel café)

En `/cafe/[cafeId]`, card nueva con lecturas chain directas (viem, server
service + ruta API + hook React Query, patrón existente):

- Referencias del café en el epoch actual: `referrals(epoch, chainCafeId)`.
- Crédito de origen pendiente: `pendingOriginCredit(epoch, chainCafeId)`
  (0 hasta finalizar; el card lo etiqueta "estimado" antes de finalize
  calculando `originPool × refs / totalReferrals` con `getEpoch`).
- Buckets del epoch: origen/adquisición/crawl/contingencia (`getEpoch`).

Estados obligatorios de spec §19: cargando, error con retry, vacío
("aún sin referencias este mes").

### 6. Migración 0018

`ALTER TYPE relayer_job_kind ADD VALUE 'referral_record';` + actualizar el
check constraint de `relayer_job` para permitir el kind nuevo con
`order_id IS NULL AND redemption_request_id IS NULL`. Enum value nuevo no
se usa en la misma transacción que lo crea (lección del 55P04 de 0014).

## Errores y recuperación

- Relayer caído: jobs `referral_record` quedan `pending`; el drain los
  procesa. Nada se pierde: el encolado ocurre en la misma transacción que
  la proyección del evento que lo origina.
- Reorg/replay del indexer: `idempotencyKey` evita duplicar el job;
  `referralId` evita duplicar on-chain.
- `close-epoch` interrumpido: re-ejecutable; claims ya hechos revierten
  `OriginAlreadyClaimed` y el script los salta.
- Café suspendido antes del claim: el contrato revierte
  `CafeNotOperational`; el script lo reporta y sigue.

## Testing

1. **Unit (handler):** confirmación normal; `ReferralIdUsed` → confirmado;
   `CafeNotOperational` → fallo permanente; `NotReferralRecorder` →
   retryable.
2. **Unit (epoch helper):** timestamp → `YYYYMM` UTC, bordes de mes.
3. **Integración (DB):** VoucherUnlocked confirmado encola exactamente un
   job `referral_record` (replay no duplica); crawl A→B→C encola dos jobs
   con las claves esperadas; migración 0018 aplica sobre DB fresca.
4. **Live journey (Anvil propio, DB fresca, mismo estado compartido que
   los demás live):** plan payment → S/5 al fondo → compra con campaña →
   referencia on-chain → `fund-epoch` reparte 40/30/20/10 exacto →
   `close-epoch` → balance mPEN del owner sube exactamente
   `originPool × refs / totalReferrals`. Cleanup conserva filas
   respaldadas por chain (lección de f4ffb06).

## Criterios de aceptación

- Demo en < 2 minutos: pagar plan, comprar (campaña o crawl), correr los
  dos scripts, ver crédito en panel café y balance del owner subir.
- Cero doble conteo bajo replay de indexer o re-ejecución de scripts.
- `drizzle-kit check`, typecheck, biome, suite serial gated y live
  journeys verdes en DB fresca.
- Migración 0014→0018 aplica limpia sobre DB de producción simulada.
