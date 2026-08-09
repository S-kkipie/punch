# Redención PUNCH on-chain — Design

**Fecha:** 2026-08-09
**Estado:** aprobado en brainstorming (sesión principal)
**Referencias:** spec maestra §02 (invariantes), §10 (reward y canje), §16 (`PunchVault`), §17 (flujo canje), §18 (servicios), §19 (estados obligatorios), §21 (errores)

## Objetivo

Reemplazar la redención PUNCH solo-Postgres (hoy deshabilitada en modo local) por el flujo real: aprobar un canje quema 12 PUNCH y paga S/3.60 al café anfitrión vía `PunchVault.redeem`, con la cadena como única autoridad del canje. Cierra el loop económico del consumidor.

## Decisiones tomadas

1. **Mock muere para PUNCH.** El canje PUNCH siempre va por cadena real vía relayer. `PostgresMockConsumerChain` queda solo para vouchers (sin rail on-chain). Invariante §02 limpio: Postgres nunca decide canje.
2. **Relayer job + polling** (no envío síncrono): reusa la máquina probada de compras — reintentos, idempotencia, recovery tras crash. `PunchVault.redeem` no tiene idempotencia on-chain (sin nonce/requestId): dos envíos = doble burn + doble payout, así que la dedupe vive en Postgres y debe escribirse antes de enviar.
3. **Café ve payouts**: historial de canjes con estado on-chain + monto, proyección de payouts acumulados, y saldo mPEN del owner leído directo de cadena (view call, sin proyección → cero drift).
4. **Enfoque estructural A — generalizar el relayer existente** (`kind` en `relayer_job`), no queue separada ni `consumer_transaction` como cola.
5. **Redeemer = wallet del relayer.** `setRedeemer(relayerAddress)` en bootstrap; el mismo wallet de sistema (`RELAYER_WALLET_INDEX`) envía compras y canjes. Un solo wallet de sistema que fondear y gestionar. Solo chain 31337 / desarrollo.

## Arquitectura y flujo

```
Consumidor (≥12 PUNCH) pide canje de reward
→ redemption_request (pending)                        [ya existe]
→ barista/owner aprueba
→ decide-service: request → approved + relayer_job kind=punch_redemption
  (única por request, misma transacción DB)
→ worker: PunchVault.redeem(userWallet, chainCafeId, chainProductId)
→ Anvil: burn 12 + transfer S/3.60 mPEN al owner del café — atómico en contrato
→ indexer: PunchBurned + RewardRedeemed + HostPaid (mismo receipt)
   → projection_punch_balance −12
   → redemption_request → confirmed
   → projection_cafe_payout +S/3.60
→ UI polling ve confirmado; barista entrega el café
```

La cadena decide: si `redeem` revierte (`InsufficientPunch`, `HostNotOperational`, `ProductNotEligibleReward`), el request falla con razón parseada. El pre-check de balance en `request-punch-redemption-service` queda como guard de UX, no autoridad.

**Guard nuevo:** un solo request `punch_reward` en estado `pending`/`approved` por consumidor (unique parcial). Evita aprobar dos y que el segundo muera por `InsufficientPunch` con 23 PUNCH.

## Datos (una migración)

### `relayer_job` — generalización

- `kind` enum nuevo `relayer_job_kind` = `consumption` | `punch_redemption`, NOT NULL, default `consumption` (backfill de filas existentes con el default).
- `order_id` pasa a nullable (sigue unique, FK intacta).
- `redemption_request_id` text nullable, unique, FK a `redemption_request` (onDelete restrict).
- CHECK: `(kind = 'consumption' AND order_id IS NOT NULL AND redemption_request_id IS NULL) OR (kind = 'punch_redemption' AND redemption_request_id IS NOT NULL AND order_id IS NULL)`.
- `payload` para canje: `{ userWallet, chainCafeId, chainProductId }` resueltos al encolar (falla 422 si falta mapping de café/producto, igual que compras).

### `redemption_request`

- Status enum gana `confirmed` y `failed` (hoy pending/approved/rejected). Semántica: `approved` = esperando cadena; `confirmed` = burn indexado; `failed` = revert permanente.
- Columna nueva `failure_reason` text nullable — razón de cadena. `rejection_reason` queda solo para rechazo humano.
- Unique parcial nuevo: `(consumer_user_id)` WHERE `kind = 'punch_reward' AND status IN ('pending','approved')`.

### `projection_cafe_payout` — nueva

- `cafe_id` text PK (FK a cafe), `total_centimos` integer NOT NULL default 0, `redemption_count` integer NOT NULL default 0, timestamps.
- Idempotencia igual que emisiones: fila ledger en `consumer_transaction` (operation `punch_redemption`, ya en el enum) con `idempotency_key = chain_redemption:<requestId>`, insert `onConflictDoNothing` como gate — solo si insertó, incrementa proyección, decrementa balance y confirma request.

### Saldo mPEN del café

Sin tabla: view call `pen.balanceOf(ownerWallet)` al renderizar el panel.

## Código

### Servicios

- `decide-punch-redemption-service`: fuera `PostgresMockConsumerChain`. Aprobar = una transacción DB: request → `approved` + insert `relayer_job` kind `punch_redemption` con payload resuelto. Re-aprobar un request ya `approved`/`confirmed` es idempotente (devuelve estado actual, no encola segundo job — unique en `redemption_request_id` lo garantiza a nivel DB).
- `request-punch-redemption-service`: sin cambios de lógica; el unique parcial nuevo convierte doble request en conflicto 409.
- Polling: sin endpoint nuevo — la página de redemptions del café ya lista los requests; con los estados `confirmed`/`failed` en el enum, re-fetch del listado basta.

### Relayer (`relayer.ts`)

- Dispatch por `kind`: `consumption` = camino actual intacto; `punch_redemption` = `writeContract` a `PunchVault.redeem(userWallet, chainCafeId, chainProductId)` con la cuenta del relayer.
- **Guard anti-doble-burn antes de enviar:** si existe ledger `chain_redemption:<requestId>` o el request ya está `confirmed`, marcar job `confirmed` sin enviar. Si el job tiene `tx_hash` previo, verificar receipt primero (patrón existente de receipts revertidos) antes de re-firmar.
- `parse-revert.ts`: agregar selectores de `PunchVault` — `InsufficientPunch(address,uint256)`, `HostNotOperational(uint256)`, `ProductNotEligibleReward(uint256,uint256)`, `NotRedeemer(address)`.
- `markJobFailed` (kind canje): request → `failed` + `failure_reason` (espejo del fix de quotes `9a519f6`). Balance intacto — nada se quemó; el consumidor puede re-pedir.
- `NotRedeemer` = bootstrap incompleto, no request malo: log ruidoso, retry normal.

### Indexer

- Handlers para eventos de `PunchVault`: `RewardRedeemed(user, hostCafeId, productId)` como ancla (con `PunchBurned` y `HostPaid` en el mismo receipt).
- Proyección: gate ledger idempotente → balance −12 (`projection_punch_balance`), request `confirmed`, payout +360 centimos en `projection_cafe_payout`.
- Correlación evento→request: por `tx_hash` del job (el job guarda el hash al enviar). Fallback si el job no existe (rebuild desde cero): correlacionar por (user wallet → userId, hostCafeId → cafeId) contra el request `approved` más antiguo de ese par — determinista porque el guard de un-request-activo impide ambigüedad.

### Reconciler / rebuild

- `clearChainDerivedPurchaseProjections` se extiende (o módulo hermano): borrar ledger `chain_redemption:%`, resetear `projection_cafe_payout`, requests `confirmed` → `approved` (el replay los re-confirma). El replay de eventos reconstruye balance y payouts exactos.
- Drift check existente (`projection_punch_balance` vs `PunchVault.balanceOf`) ya cubre burns una vez el indexer los proyecta.

### Bootstrap local

- `chain:bootstrap-local`: llamar `PunchVault.setRedeemer(relayerAddress)` post-deploy. El wallet del relayer ya queda fondeado con ETH por el bootstrap actual.

### UI

- Página redeem consumidor: quitar gate `chainMode === "local"` para PUNCH — el flujo real existe.
- Página redemptions café: polling de estado tras aprobar (procesando → confirmado/fallido), payout S/3.60 por fila confirmada, razón de fallo visible.
- Panel café: card con saldo mPEN (view call) + total payouts y conteo de la proyección.

## Errores y recovery

| Caso | Comportamiento |
|---|---|
| Revert permanente (`InsufficientPunch`, host no operacional, producto no elegible) | Job `failed` + request `failed` + razón legible. Balance intacto. |
| Transitorio (RPC caído, nonce) | Retry con backoff — mecanismo de compras sin cambios. |
| `NotRedeemer` | Log ruidoso (bootstrap incompleto), retry. |
| Crash post-tx pre-DB | Cadena tiene el burn; indexer proyecta por eventos; guard anti-doble-burn impide re-envío. |
| Drift | Reconciler detecta, rebuild replay burns → converge. |

## Testing

- **Unit:** decide-service encola job y es idempotente; guard un-request-activo; `markJobFailed` propaga a request; parse-revert nuevos selectores.
- **Integration** (`PUNCH_RUN_INTEGRATION=1`): migración + queue + handlers indexer con eventos sintéticos; rebuild con canjes (confirmed → approved → replay → confirmed, balance y payout exactos, idempotencia del ledger).
- **Live** (`PUNCH_RUN_LIVE_CHAIN=1`): journey completo — consumidor llega a 12 PUNCH, request, approve, burn real, balance 0, payout mPEN verificado con `pen.balanceOf(ownerWallet)`. Doble-aprobación no doble-quema.
- **Aceptación navegador:** demo-local, comprar 1 café (11→12), canjear, ver 0/12 y payout en panel café.
- Cada fix con RED-by-revert; verificación siempre en DB fresca + Anvil fresco (nunca la DB del `.env`).

## Fuera de alcance

- Voucher redemption on-chain (sigue mock).
- `NetworkFund` / epochs / créditos de origen.
- Redención en Arbitrum Sepolia.
- Límites diarios / anti-colusión (§20 — proyecto aparte).

## Coordinación con sesiones paralelas

punch-b4 (pago de plan, `PlanManager`) y punch-08 (`CampaignEscrow`) trabajan en worktrees propios sobre `main` @ `47a8e88`. Overlap esperado: `src/core/chain/abis.ts`, indexer, migraciones Drizzle (numeración). Merge secuencial; esta rama probablemente merge primero por tocar el core del relayer.
