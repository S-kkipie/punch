# Compra Yape + reconciliación — diseño

Fecha: 2026-08-08
Estado: aprobado en brainstorming
Referencias: spec maestra §15, §17 (Compra Yape, Límite Yape), §18 (Postgres y backend)

## Objetivo

Vertical backend completo para la compra Yape: API de orden de compra con
atestación dual, firma EIP-712 server-side, relayer con cola en Postgres,
indexer de eventos a proyecciones y reconciliación automática
proyección ↔ cadena. Corre contra anvil local (deploy a testnet queda fuera
de este sub-proyecto).

## Decisiones tomadas

- **Sin API de Yape.** El pago Yape es off-chain e inobservable. MVP confía
  en atestación dual: comprador y vendedor deben confirmar; el contrato
  `ConsumptionLog` exige ambas firmas.
- **Ambas firmas custodiales, server-side.** El backend firma el proof
  EIP-712 con las wallets derivadas del usuario y del café
  (`src/core/chain/server/wallet`) tras la confirmación de cada parte en su
  UI. Cero manejo de llaves en cliente.
- **Cadena: anvil local.** `addresses.ts` sigue en 0x0 para testnet; un
  script de dev levanta anvil + despliega los 7 contratos.
- **Reconciliación automática.** Job cada 1 minuto compara invariantes y
  se auto-repara reindexando. Sin botón manual en MVP.
- **Enfoque A:** worker único + cola en Postgres. Sin Redis ni librerías de
  cola; escala del piloto (4 cafés) no lo justifica.

## Arquitectura

```
PWA (punch-aa)          Panel café
     │                       │
     ▼                       ▼
API /api/v1/purchases  (Elysia, dominio src/core/purchase)
     │
     ▼
Postgres: purchase_orders + relayer_jobs + proyecciones + indexer_cursor
     ▲                                            ▲
     │ estado tx                                  │ proyecciones
┌────┴────────────────────────────────────────────┴───┐
│ scripts/worker.ts  (proceso aparte, tsx)            │
│  loop 1: relayer    — drena relayer_jobs, envía tx  │
│  loop 2: indexer    — getLogs → proyecciones        │
│  loop 3: reconciler — invariantes cada 1 min        │
└──────────────────────┬──────────────────────────────┘
                       ▼
              anvil local (7 contratos)
```

Piezas nuevas:

- `src/core/purchase/` — dominio orden de compra (patrón
  `domain/server/client` existente).
- `src/core/chain/server/relayer/` — firma EIP-712 + envío de tx.
- `src/core/chain/server/indexer/` — eventos → proyecciones.
- `src/core/chain/server/reconciler/` — invariantes + reparación.
- `scripts/worker.ts` — proceso único con los 3 loops.
- `scripts/dev-chain.ts` — anvil + deploy de los 7 contratos + direcciones
  locales para `addresses.ts`.

## Flujo de compra

Ciclo de vida de `purchase_orders`:

```
user_confirmed → cafe_confirmed → queued → submitted → confirmed
      │                                        └→ failed
      └→ expired (expiry vencido sin confirmación del café)
```

La orden nace `user_confirmed`: crearla ES la atestación del comprador.

1. Usuario en PWA declara "pagué por Yape": `POST /purchases` con
   `{cafeId, productId, amount, yapeRef}`. Backend crea orden, genera
   `nonce` (secuencial por par usuario-café: máximo entre cadena y órdenes
   pendientes), `expiry = now + 15 min`,
   `receiptHash = keccak256(yapeRef)`. Estado `user_confirmed`.
2. Panel café lista órdenes pendientes; café confirma "Yape recibido":
   `POST /purchases/:id/confirm`. Estado `cafe_confirmed`.
3. Backend firma `ConsumptionProof{cafeId, user, productId, amount,
   receiptHash, nonce, expiry}` (EIP-712, dominio de `ConsumptionLog`) con
   ambas wallets custodiales e inserta en `relayer_jobs`
   (UNIQUE `order_id` → idempotencia). Estado `queued`.
4. Worker toma el job con `FOR UPDATE SKIP LOCKED`, llama
   `recordConsumption(proof, cafeSig, userSig)`, guarda `tx_hash`
   (estado `submitted`), espera receipt (estado `confirmed`). On-chain:
   `ConsumptionLog` valida firmas y límites, `PlanManager` consume 1
   crédito, `PunchVault` emite 1 PUNCH.
5. Revert o timeout: reintento con backoff exponencial, 3 intentos máximo,
   luego `failed` con `failure_reason` legible.

## Modelo de datos

| Tabla | Columnas clave |
|---|---|
| `purchase_orders` | id, cafe_id, user_id, product_id, amount, yape_ref, receipt_hash, nonce, expiry, status, failure_reason, tx_hash |
| `relayer_jobs` | id, order_id UNIQUE, payload (proof + firmas), attempts, next_retry_at, status |
| `projection_punch_balances` | user_address, balance, last_block |
| `projection_cafe_credits` | cafe_id, credits, last_block |
| `projection_consumptions` | tx_hash + log_index UNIQUE, cafe_id, user, receipt_hash, block |
| `indexer_cursor` | contract, last_processed_block |
| `projection_status` | projection, paused, last_good_block |

UNIQUE `tx_hash + log_index` hace inocuo el evento duplicado.

## Reconciliación

Job cada 1 minuto. Invariantes:

1. `SUM(projection_punch_balances.balance)` == `PunchVault.totalSupply()`.
2. Por café activo: `projection_cafe_credits.credits` == crédito on-chain
   en `PlanManager`.
3. `COUNT(projection_consumptions)` == eventos `ConsumptionRecorded`
   acumulados según cursor.

Ante divergencia:

1. Marca la proyección `paused`; la API la reporta `stale` (la PWA muestra
   "actualizando…", nunca números viejos como frescos).
2. Borra proyecciones afectadas desde `last_good_block` (checkpoint del
   último chequeo verde).
3. Reindexa con `getLogs` desde ese bloque.
4. Re-compara. Verde → reanuda + log warn. Rojo → queda pausado + log
   error. Alerta MVP = log estructurado, sin paging.

## Manejo de errores

| Falla | Manejo |
|---|---|
| Worker muere con tx enviada sin registrar | Al arrancar, jobs `submitted` sin receipt: consulta por `tx_hash`; si la tx no existe, reenvía. El nonce del proof hace el reenvío seguro (revert si ya consumido). |
| Revert "nonce ya usado" | La compra ya entró por otro camino: verificar evento y marcar `confirmed`. |
| Revert crédito insuficiente / expiry / límite diario | `failed` + razón legible para la PWA. |
| RPC caído | Backoff en los 3 loops; el cursor no avanza; nada se pierde. |
| Café nunca confirma | Barrido periódico marca `expired` toda orden con expiry vencido. |

## Testing

- **Unit (vitest):** transiciones de estado de orden, generación de nonce,
  hash EIP-712 verificado contra `ConsumptionLog.hashProof()` como vector,
  parseo de reverts.
- **Integración (vitest + anvil):** vertical completo — orden → doble
  confirmación → worker → evento → proyección. Casos: revert, evento
  duplicado, worker reiniciado a mitad de envío.
- **Reconciler:** corromper proyección a propósito → detecta → repara →
  invariantes verdes. E2E: matar indexer, generar compras, revivir →
  repara.

## Fuera de alcance

- Deploy a Arbitrum Sepolia.
- Integración real con API de Yape/POS.
- Detección de colusión y motor de riesgo (spec §20) más allá de los
  límites que el contrato ya impone.
- Notificaciones push al café por orden pendiente.
