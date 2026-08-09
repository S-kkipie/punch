# Pago de plan y packs del café — diseño

Fecha: 2026-08-09
Estado: aprobado en brainstorming, pendiente de plan de implementación
Spec maestra: `docs/superpowers/specs/2026-08-07-punch-master-spec.md` §07, §09, §16, §17, §23, §24
Rama base: `main` local @ `c9b3923`

## 1. Problema

Los contratos ya resuelven la economía del plan: `PlanManager.subscribe` y `PlanManager.buyPack`
hacen el split y acreditan 100 créditos en una sola transacción (§17), y el indexer ya proyecta
`PlanActivated` y `PackPurchased` sobre `projection_cafe_credit`. Lo que no existe es el producto:
hoy la única forma de que un café tenga plan es `scripts/dev-chain.ts`. Un café no puede activar su
plan, comprar un pack, ni ver cuántos créditos le quedan.

Este sub-proyecto entrega esa capa: panel del café más backend (servicio, cola y runner) para pagar
plan y packs, y para ver créditos, reserva y rollover.

## 2. Alcance

Incluye:

- Activar plan (S/49) y comprar pack (S/40) desde el panel del café.
- Orden durable con reintentos, historial de pagos y estado consultable.
- Lectura de plan activo, créditos restantes y reserva no asignada.
- Indicador de créditos en dashboard y terminal del café.

No incluye:

- `cancel()` y `withdrawUnusedReserve()` del contrato (§09 Cancelación). Post-MVP de este
  sub-proyecto: son raros en el piloto y agregan estados irreversibles.
- Ciclo mensual, renovación automática o cobro recurrente (ver §5).
- Cobro fiat real. Ver §4: el fondeo es de tokens de prueba en la cadena local.
- Despliegue en Arbitrum Sepolia.

## 3. Restricciones de contrato que condicionan el diseño

De `packages/contracts/src/PlanManager.sol`:

- `subscribe(cafeId)` y `buyPack(cafeId)` exigen `registry.isAuthorized(cafeId, msg.sender)` y
  `registry.isOperational(cafeId)`.
- `_purchase` hace `pen.safeTransferFrom(msg.sender, ...)`. **El pagador es el firmante.** El wallet
  del relayer no puede pagar por el café; hay que firmar con el wallet custodial del miembro.
- `buyPack` revierte con `PlanNotActive` si el café no tiene plan. `subscribe` no revierte si ya hay
  plan: simplemente suma otros 100 créditos.
- `planActive` es un booleano sin vencimiento. La cadena no conoce meses.

De `packages/contracts/src/MockPEN.sol`:

- `faucet(uint256 amount)` es **público**, con tope `FAUCET_MAX = 1000e6` por llamada. El propio
  firmante puede auto-fondearse sin la llave del deployer y sin `mint` (que es `onlyOwner`).

Constantes: `PLAN_PRICE = 49e6`, `PACK_PRICE = 40e6`, `CREDITS_PER_PURCHASE = 100`,
`RESERVE_PER_CREDIT = 300_000` (S/0.30).

## 4. Decisiones

| # | Decisión | Razón |
|---|---|---|
| D1 | Auto-fondeo con tokens de prueba, solo cadena local 31337 | No hay testnet ni producción en este sub-proyecto. El cobro fiat real entra por la costura de `funding.ts` cuando exista. |
| D2 | Orden durable + runner, patrón `src/core/purchase/` | Sobrevive caídas, deja historial de pagos, mismo patrón que ya conoce el equipo. |
| D3 | Módulo nuevo `src/core/plan/` con tabla y runner propios | Cero cambios en `purchase/`, `abis.ts`, `apply-event.ts` y `relayer.ts` → cero conflicto con las sesiones paralelas de redención y campañas. |
| D4 | Créditos desde la proyección; `planActive` y `unallocatedReserve` leídos on-chain | Evita migrar `chain-schema.ts` y tocar `apply-event.ts`/reconciler, justo los archivos compartidos. Son dos lecturas baratas. |
| D5 | Cualquier miembro autorizado paga, firmando con su propio wallet | Permite pagar desde mostrador. El contrato acepta operadores autorizados, no solo al dueño. |
| D6 | Sin ciclo mensual: activación más packs; el rollover solo se muestra | Es exactamente lo que hace el contrato. Inventar un ciclo en Postgres crea dos verdades que divergen. |

Consecuencia conocida de D5: `withdrawUnusedReserve` está restringido al dueño por el contrato, así
que si un barista paga, la reserva de esa compra solo la puede retirar el dueño. Aceptable: retirar
está fuera de alcance y la reserva es del café, no del firmante.

Consecuencia conocida de D3: `plan_order` duplica alrededor de 100 líneas de lógica claim/retry/
backoff de `relayer.ts`. Deuda deliberada. Unificar en una cola genérica (`kind` + `subject_id`, sin
FK a `purchase_order`) es trabajo posterior, cuando las tres ramas paralelas hayan mergeado.

## 5. Rollover y ciclo mensual

El rollover es automático en el contrato: los créditos se acumulan en `credits[cafeId]` y su reserva
en `unallocatedReserve[cafeId]`. Nada expira. Cada crédito conserva S/0.30 de reserva no asignada;
al emitir, `consumeCredit` transfiere esos S/0.30 al vault y pasan a respaldar pasivo vivo (§09).

Por lo tanto no hay nada que implementar para el rollover más allá de mostrarlo. El panel lo dice
explícitamente en vez de dejar que el café lo asuma.

No hay ciclo mensual en este sub-proyecto. Recargar es comprar packs. Si el piloto pide renovación
periódica, es una decisión nueva que probablemente requiere cambio de contrato, no una tabla en
Postgres.

## 6. Arquitectura

Módulo nuevo, espejo de `src/core/purchase/`:

```
src/core/plan/
  domain/
    types.ts            estados, kinds, clases de error
    schemas.ts          validación de entrada/salida (patrón Elysia + typebox)
    transitions.ts      máquina de estados pura
  server/
    repository/plan-repository.ts    inserción, claim con lease, marcadores de estado
    services/
      create-plan-order-service.ts   autorización + reglas de kind + anti doble cobro
      get-plan-order-service.ts      estado para el polling
      list-plan-orders-service.ts    historial por café
      get-plan-status-service.ts     planActive + reserva on-chain + créditos de proyección
    runner/
      plan-runner.ts    claim → fondear → aprobar → ejecutar → confirmar
      funding.ts        top-up de gas, con guarda de entorno
    api/
      router.ts + routes/
  client/
    hooks.ts
    ui/                 tarjeta de plan, tarjeta de créditos, historial
```

Archivos existentes que se tocan (mínimo, ninguno compartido con las otras sesiones):

- `src/server/drizzle/schemas/plan-schema.ts` — nuevo archivo, tabla nueva.
- Registro del router en el árbol de `/api/v1`.
- `scripts/worker.ts` — un tick nuevo junto al relayer.
- Dashboard del café y terminal — insertar el indicador de créditos.

No se tocan: `src/core/chain/abis.ts` (ya tiene `planManager` y `mockPEN` completos),
`apply-event.ts`, `indexer.ts`, `relayer.ts`, `chain-schema.ts`, `purchase-schema.ts`.

## 7. Datos

Tabla `plan_order`, en `src/server/drizzle/schemas/plan-schema.ts`:

| columna | tipo | nota |
|---|---|---|
| `id` | text pk uuid | |
| `cafe_id` | text fk `cafe` restrict | |
| `chain_cafe_id` | integer | snapshot, para que el runner no necesite join |
| `user_id` | text fk `user` restrict | quién pagó |
| `kind` | enum `plan_order_kind` (`plan`, `pack`) | |
| `price` | bigint | snapshot: 49e6 o 40e6 |
| `signer_address` | text | wallet del firmante, minúsculas |
| `signer_wallet_index` | integer | índice HD para derivar la cuenta |
| `status` | enum `plan_order_status` (`pending`, `submitted`, `confirmed`, `failed`) | |
| `attempts` | integer default 0 | |
| `next_retry_at` | timestamp default now | |
| `tx_hash` | text nullable | |
| `last_error` | text nullable | |
| `failure_reason` | text nullable | código legible para la UI |
| `claimed_until` | timestamp nullable | lease del runner |
| `created_at`, `updated_at` | timestamp | |

Índices:

- `plan_order_cafe_created_idx` sobre `(cafe_id, created_at desc)` — historial.
- `plan_order_status_retry_idx` sobre `(status, next_retry_at)` — claim del runner.
- **Único parcial** `plan_order_cafe_inflight_uq` sobre `cafe_id` donde
  `status in ('pending','submitted')` — un pago en vuelo por café. Un doble clic devuelve la orden
  existente, nunca cobra dos veces.
- `check` `price > 0`.

Orden y trabajo viven en la misma tabla, a diferencia de purchase que separa `purchase_order` de
`relayer_job`. Aquí no hay proof ni payload que guardar: el runner reconstruye la transacción desde
`cafe_id`, `kind` y `signer_wallet_index`.

## 8. Máquina de estados

```
pending ──(receipt ok)──> confirmed
   │
   ├──(error transitorio, attempts < 5)──> pending con backoff
   ├──(error permanente)────────────────> failed
   └──(tx enviada)─────────────────────> submitted
                                            │
                                            ├──(receipt ok)──> confirmed
                                            ├──(receipt revert)──> failed
                                            └──(lease vencido sin receipt)──> pending
```

`confirmed` y `failed` son terminales. `transitions.ts` implementa esto como función pura y es la
única fuente de verdad sobre qué transición es legal.

## 9. Flujo

```
Café pulsa "Activar plan" o "Comprar pack"
→ POST /api/v1/plans/orders {cafeId, kind}
   ├─ el usuario es miembro del café (Postgres, tabla cafe_member)
   ├─ el wallet del usuario está autorizado on-chain (isAuthorizedCafeOperator, ya existe)
   ├─ el café es operacional
   ├─ reglas de kind: plan exige planActive == false; pack exige planActive == true
   ├─ no hay otra orden en vuelo para el café
   └─ inserta plan_order(pending) → 201 {orderId}
→ la UI hace polling de GET /api/v1/plans/orders/:id
→ plan-runner, tick de 2 s en scripts/worker.ts
   ├─ claim con lease (patrón de claimSubmittedJobs)
   ├─ gas: si el balance ETH del firmante está bajo el mínimo → top-up (funding.ts)
   ├─ mPEN: si balanceOf(firmante) < price → faucet(price)
   ├─ allowance(firmante, planManager) < price → approve(planManager, price)
   ├─ simulateContract, luego writeContract subscribe/buyPack → submitted + tx_hash
   └─ tick siguiente: receipt + log PlanActivated/PackPurchased → confirmed
→ el indexer existente ve el evento → projection_cafe_credit += 100
```

Dos verdades separadas que no se pisan: el runner marca `confirmed` por el receipt; los créditos los
mueve el indexer. La UI muestra el pago confirmado de inmediato y los créditos aparecen en el
siguiente tick del indexer.

### Idempotencia

Cada intento relee el estado de la cadena antes de actuar: balance de mPEN, allowance, y `planActive`
cuando corresponde. No hay columna de paso. Un reintento tras una caída no vuelve a fondear ni a
aprobar de más, porque las precondiciones ya se cumplen y esos pasos se saltan.

### Fondeo

`funding.ts` expone dos operaciones tras una guarda de entorno:

- mPEN: `faucet(price)` firmado por el propio firmante. Público en el contrato, no necesita llaves
  privilegiadas. Precio máximo 49e6, muy por debajo de `FAUCET_MAX`.
- Gas: si el firmante tiene menos del mínimo de ETH, se le envía desde la cuenta de desarrollo de
  anvil (índice 0 de la mnemónica `test test ... junk`), la misma que ya usa `scripts/dev-chain.ts`.
  Es una llave de prueba de la cadena 31337, nunca sale a logs ni a clientes.

Fuera de `CHAIN_ENV === "local"`, ambas fallan con `funding_unavailable` y la orden queda `failed`
con ese motivo. Ahí es donde entrará el cobro fiat real: reemplazar `funding.ts` por confirmación de
pago Yape más transferencia de mPEN, sin tocar el resto del runner.

## 10. API

Prefijo `/api/v1/plans`, patrón Elysia con middleware `authed`, idéntico a `purchaseRouter`.

| ruta | descripción |
|---|---|
| `POST /orders` | crea la orden. 201 con la orden, 409 si ya hay una en vuelo, 403 si no autorizado, 422 si la regla de kind no se cumple |
| `GET /orders/:id` | estado de una orden, para el polling |
| `GET /cafes/:cafeId/orders` | historial de pagos del café |
| `GET /cafes/:cafeId/status` | `planActive`, `unallocatedReserve` on-chain, créditos de la proyección, y si el wallet del usuario está autorizado |

Todas exigen membresía en el café. Ninguna expone claves, índices HD ni mnemónicas.

## 11. Errores

Clasificación en el mismo espíritu que `parse-revert.ts`:

**Permanentes** — `failed` con `failure_reason` legible, sin reintento:

| código | origen |
|---|---|
| `not_authorized` | `NotAuthorizedForCafe` |
| `cafe_not_operational` | `CafeNotOperational` |
| `plan_not_active` | `PlanNotActive` al comprar pack |
| `faucet_cap_exceeded` | `FaucetCapExceeded` |
| `funding_unavailable` | entorno no local sin fondeo configurado |
| `reverted` | el receipt de una tx ya enviada volvió con estado revertido |

**Transitorios** — backoff exponencial, tope de 5 intentos, luego `failed` con motivo
`max_attempts` y el último error en `last_error`: RPC caído, conflicto de nonce, timeout esperando
receipt.

**Colgados** — orden `submitted` cuyo lease venció sin receipt: vuelve a `pending`, igual que
`recoverStuckJobs`.

El `simulateContract` previo convierte casi cualquier revert en fallo limpio antes de gastar gas.

## 12. UI

### Ruta nueva `cafe/[cafeId]/plan`

- **Estado del plan**: activo o inactivo, créditos restantes, reserva no asignada en soles
  (`créditos × 0.30`).
- **Acción principal**: si el plan está inactivo, "Activar plan · S/49"; si está activo,
  "Comprar pack · S/40". Antes de confirmar se muestra el split: que el café vea a dónde va su
  dinero es la tesis de §09.
  - Plan S/49 → S/30 reserva de rewards, S/5 fondo común, S/14 tesorería PUNCH, +100 créditos.
  - Pack S/40 → S/30 reserva de rewards, S/5 fondo común, S/5 tesorería PUNCH, +100 créditos.
- **Rollover explícito**: "Tus créditos no vencen. Los que no emitas siguen disponibles, y con ellos
  su reserva de S/0.30 por crédito."
- **Historial de pagos**: fecha, tipo, monto, estado, hash de transacción.
- **En vuelo**: botón bloqueado y polling mientras hay una orden `pending` o `submitted`; mensaje
  legible si termina en `failed`.
- **Wallet no autorizado on-chain**: la página lo explica y esconde el botón, en vez de dejar que
  falle en el runner.

### Indicador de créditos

Número de créditos restantes en el dashboard del café y en el terminal, con aviso cuando quedan
pocos (umbral 10). Evita que un café descubra que se quedó sin créditos por una emisión fallida
delante del cliente.

## 13. Pruebas y criterios de aceptación

Verificación siempre con base de datos fresca: crear DB → `pnpm db:migrate` → `pnpm db:seed` →
anvil fresco en 31337 → `pnpm chain:deploy` → `pnpm chain:bootstrap-local`.

**Unitarias** (sin gate):

- `transitions.ts`: toda transición legal e ilegal.
- Clasificación permanente contra transitorio de cada error.
- Reglas de kind: `plan` con plan activo se rechaza; `pack` sin plan se rechaza.
- Cálculo de reserva y del split mostrado en la UI.

**Servicios con dependencias mockeadas**:

- Autorización: no miembro, miembro sin wallet autorizado on-chain, café no operacional.
- Anti doble cobro: segunda orden en vuelo para el mismo café.
- Runner: reintento transitorio con backoff, fallo permanente sin reintento, idempotencia de faucet
  y approve cuando las precondiciones ya se cumplen, recuperación de orden colgada.

**Integración** (`PUNCH_RUN_INTEGRATION=1`):

- Repositorio contra Postgres real.
- El único parcial bajo inserciones concurrentes deja pasar exactamente una.

**Cadena viva** (`PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1`):

- Recorrido completo: café sin plan → activar plan → evento `PlanActivated` → proyección en 100
  créditos → comprar pack → 200 créditos → una compra Yape emite 1 PUNCH → 199 créditos.
- Saldos tras activar el plan: vault +30e6, fondo común +5e6, tesorería +14e6.
- Tras comprar el pack: vault +30e6, fondo común +5e6, tesorería +5e6.

**Manual**: recorrido del panel con Playwright.

**Criterio de aceptación (§24)**: un café ficticio pasa de cero a poder emitir usando solo el panel,
sin ejecutar `scripts/dev-chain.ts`.

## 14. Riesgos

| Riesgo | Mitigación |
|---|---|
| El wallet del miembro no tiene gas en anvil y el pago falla | Top-up de gas en el runner antes de firmar, con mínimo configurable |
| Doble clic cobra dos veces | Único parcial sobre órdenes en vuelo, más lectura previa |
| El indexer va atrasado y el café no ve sus créditos | La UI separa "pago confirmado" de "créditos disponibles" y avisa si están por llegar |
| La deuda de la cola duplicada se olvida | Queda escrita aquí como trabajo posterior explícito |
| `faucet` en un entorno no local regalaría dinero | Guarda de entorno: fuera de local falla con `funding_unavailable` |
