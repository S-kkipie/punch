# CampaignEscrow en el runtime — Diseño

Fecha: 2026-08-09
Estado: aprobado en brainstorm
Spec madre: `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§12, §15, §16, §21, §29)
Spec del contrato: `docs/superpowers/specs/2026-08-08-campaignescrow-design.md`

## Propósito

`CampaignEscrow.sol` está completo y desplegado por `scripts/dev-chain.ts`, pero
ningún proceso del backend lo usa. Las campañas viven sólo en Postgres: la
calificación por compra y el desbloqueo de voucher ocurren dentro de la
transacción del indexer, sin presupuesto prefondeado, sin cupo real y sin payout
al café.

Este diseño conecta el escrow al runtime para el caso de **adquisición
verificada** (§12.1) de punta a punta: el café crea, fondea y publica su campaña
con mPEN propio; la calificación por compra desbloquea el voucher en cadena; y el
canje paga el `voucherPayout` al dueño del café. Postgres deja de decidir y pasa
a proyectar (§15).

### En alcance

- Ciclo de vida de campaña de adquisición: `createCampaign`, `fundCampaign`,
  `publishCampaign`.
- `unlockVoucher` disparado por calificación indexada.
- `redeemVoucher` disparado por la aprobación de canje del café.
- Proyección de los eventos del escrow a Postgres.
- Generalización del rail de relayer para soportar ops que no son compras.
- Pantalla de campañas del café y estado de fondos leído de cadena.

### Fuera de alcance

- Coffee crawl financiado por el fondo común (`NetworkFund.allocateCampaignBudget`
  + `assignBudget`). El crawl sigue con su camino actual en Postgres hasta un
  segundo slice.
- `cancelUnpublishedCampaign`, `recoverExpiredBudget`, `recordProgress`.
- Deploy a Arbitrum Sepolia.

## Decisiones aprobadas

1. **Slice vertical de adquisición.** Un solo caso de uso completo antes que
   varios a medias. El crawl queda para después.
2. **Wallet de ops propia.** Nuevo índice derivado (`OPS_WALLET_INDEX`) que es el
   `owner` de `CampaignEscrow`. Separada de la wallet del relayer, que firma en
   caliente en cada compra y es la más expuesta. El relayer queda como
   `campaignOperator`.
3. **La cadena manda, Postgres proyecta.** El voucher existe cuando el indexer ve
   `VoucherUnlocked`, no cuando el usuario califica. No hay estado optimista ni
   ventana donde Postgres afirme algo que la cadena no respalde.
4. **El café elige payout y cupo.** El presupuesto requerido se deriva
   (`payout × cupo`) y la UI le dice exactamente cuánto fondear. `expiry` on-chain
   = `windowEnd` de la campaña, para que no puedan divergir.
5. **Corte limpio.** Toda fila de `campaign` tiene contraparte on-chain. No hay
   camino de unlock para campañas sin `chainCampaignId`. Las campañas de seed se
   crean en cadena desde `chain:bootstrap-local`. Requiere DB fresca; no hay
   backfill. Esto no alcanza a los coffee crawls: viven en `coffee_crawl`, no en
   `campaign`, y su camino en Postgres queda intacto hasta el segundo slice.
6. **Preflight más aviso explícito.** Antes de firmar el unlock, el handler
   verifica en cadena cupo, expiry y pausa. Un rechazo permanente se registra
   como motivo en el efecto y la UI muestra "campaña agotada" en lugar de un
   voucher que nunca llega.
7. **Rail de relayer generalizado.** `relayer_job` deja de ser exclusivo de
   compras y `relayer.ts` deja de conocer `recordConsumption`. Las tres líneas de
   trabajo en curso (campañas, redención PUNCH, pago de plan) necesitan lo mismo.

## Arquitectura

### Módulo nuevo: `src/core/campaign/`

Calcado del patrón de `src/core/purchase/`.

- `domain/types.ts`, `domain/schemas.ts` — parámetros de campaña y su validación.
- `domain/transitions.ts` — transiciones del ciclo de vida y qué op corresponde a
  cada estado.
- `server/repository/campaign-repository.ts` — fila de intención, enlace on-chain
  y lectura de la proyección.
- `server/services/` — `create-campaign`, `fund-campaign`, `publish-campaign`,
  `get-campaign-funding`.
- `server/api/routes/` — endpoints del café, montados en el router existente.

### Cambios en `src/core/chain/server/`

- `relayer/relayer.ts` — se queda con el drain genérico: claim con lease, backoff
  exponencial, clasificación de reverts, recuperación de jobs colgados. Deja de
  saber qué contrato o función se invoca.
- `relayer/handlers/` — directorio nuevo. Un handler por `kind`, cada uno
  declarando: qué llave firma, cómo construir el `writeContract`, cómo simular el
  replay ante un revert, qué reverts son idempotentes (éxito convergente), y qué
  hacer al confirmar.
- `indexer/campaign-projection.ts` — proyección de los eventos del escrow,
  invocada desde `apply-event.ts`.
- `indexer/indexer.ts` — una entrada más en `sources`:
  `source("campaignEscrow", abis.campaignEscrow, [...])`.

`src/core/chain/abis.ts` **no se toca**: el ABI generado ya incluye todas las
funciones, eventos y errores de `CampaignEscrow`.

### Cambio de responsabilidad en `src/core/punch/`

`server/repository/campaigns.ts` deja de crear el voucher en
`unlockCampaignVoucher`; pasa a encolar el job de unlock. El voucher lo crea la
proyección. `findActiveCampaignForCafe` pasa a leer elegibilidad de la
proyección: campaña publicada, dentro de ventana y con cupo libre.

## Datos

### `campaign` — intención, no estado

Campos nuevos:

| Campo | Tipo | Nota |
|---|---|---|
| `chainCampaignId` | `integer UNIQUE` | nullable hasta indexar `CampaignCreated` |
| `voucherPayout` | `bigint` | mPEN, 6 decimales; congelado al publicar |
| `maxVouchers` | `integer` | congelado al publicar |

`expiry` no se guarda: es `windowEnd`. La fila no lleva estado de ciclo de vida
ni saldo — eso lo dicta la cadena.

### `projection_campaign` — tabla nueva

Misma forma que `projection_cafe_credit`. Escrita **sólo** por el indexer.

`voucherPayout`, `maxVouchers` y `expiry` aparecen también acá, y la duplicación
es deliberada: en `campaign` son lo que el café pidió, y acá son lo que la cadena
congeló al publicar. Toda decisión de elegibilidad lee esta tabla, nunca la otra.
Si divergen, la campaña se publicó con parámetros distintos a los solicitados y
eso es un bug que hay que poder ver.

| Campo | Tipo |
|---|---|
| `chainCampaignId` | `integer PRIMARY KEY` |
| `status` | enum `draft \| published \| cancelled` |
| `budget` | `bigint` |
| `voucherPayout` | `bigint` |
| `maxVouchers` | `integer` |
| `expiry` | `timestamp` |
| `unlockedCount` | `integer` |
| `redeemedCount` | `integer` |
| `lastBlock` | `bigint` |

### `relayer_job` — generalizado

- `orderId` pasa a nullable. Su unicidad se muda a un índice único parcial sobre
  `kind = 'consumption_record'`, para no perder la garantía actual.
- `kind` — enum nuevo `relayer_job_kind`.
- `idempotencyKey` — `text NOT NULL UNIQUE`. Los jobs de compra existentes se
  crean con `consumption:${orderId}`.

Kinds y llave firmante:

| Kind | Firma | Clave de idempotencia |
|---|---|---|
| `consumption_record` | relayer | `consumption:${orderId}` |
| `campaign_create` | ops | `campaign_create:${campaignId}` |
| `campaign_fund_approve` | dueño del café | `campaign_fund_approve:${campaignId}:${seq}` |
| `campaign_fund` | dueño del café | `campaign_fund:${campaignId}:${seq}` |
| `campaign_publish` | ops | `campaign_publish:${campaignId}` |
| `voucher_unlock` | `campaignOperator` | `voucher_unlock:${chainCampaignId}:${userAddress}` |
| `voucher_redeem` | `campaignOperator` | `voucher_redeem:${redemptionRequestId}` |

`seq` distingue fondeos sucesivos de una misma campaña draft.

### Otros

- `consumer_voucher` gana `chainUnlockTxHash`. Su `redeemedAt` pasa a escribirse
  desde la proyección de `VoucherRedeemed`.
- `chain_purchase_effect` gana `failureReason text` nullable: ahí queda el motivo
  del unlock rechazado que la UI muestra al usuario.

## Flujos

### Crear, fondear, publicar

El café abre `(workspace)/cafe/[cafeId]/campaigns`. El formulario pide nombre,
ventana, payout por voucher y cupo, y muestra en vivo el presupuesto requerido y
el saldo mPEN de la wallet del café.

**Crear.** El service valida rol `owner` y los parámetros, inserta la fila
`campaign` sin `chainCampaignId`, y encola `campaign_create` firmado por ops con
`sourceCafeId = cafe.chainCafeId`.

La correlación de vuelta la resuelve el propio job: `CampaignCreated(campaignId,
sourceCafeId)` no apunta a la fila de Postgres, y `sourceCafeId` no alcanza
porque un café puede tener varias campañas. Al confirmar, el handler parsea
`CampaignCreated` del receipt de *su* transacción y escribe el `chainCampaignId`.
Leer `nextCampaignId` antes de mandar sería frágil con creaciones concurrentes;
el receipt es determinista.

**Fondear.** `fundCampaign` mueve mPEN del que firma, así que firma la wallet
custodial del dueño del café, no ops. Como ERC-20 exige `approve` antes de
`transferFrom`, y el drain está armado para una transacción por job, son dos jobs
encadenados: `campaign_fund_approve` y, al confirmar, `campaign_fund`. Cada paso
queda observable y reintentable por separado.

**Publicar.** El botón se habilita cuando `projection_campaign.budget ≥ payout ×
cupo` — cuando la cadena lo confirma, no cuando el café cree haber pagado. El
service encola `campaign_publish` (ops), cuyo handler relee el presupuesto en
cadena antes de firmar. Al indexar `CampaignPublished`, la campaña queda
publicada y sus parámetros congelados.

### Unlock

La compra se confirma igual que hoy: el indexer procesa `ConsumptionRecorded` y
llama a `applyChainPurchaseEffects` dentro de su transacción.

La calificación se decide contra la proyección, no contra `campaign.active`:
campaña publicada, dentro de ventana, `unlockedCount < maxVouchers`, más el
`hasPriorPaidPurchase` existente. La proyección *es* estado de cadena —
construida con los eventos indexados hasta el bloque en curso — así que ese
chequeo no necesita RPC, lo que importa porque estamos dentro de una transacción
de Postgres.

Si califica, se registra el efecto `campaign_qualification` como hoy (idempotente
por `(order, kind, target)`) y se encola `voucher_unlock`. El indexer **no crea el
voucher**. Encolar dentro de la misma transacción hace el job atómico con la
confirmación de la compra que lo originó.

El preflight caro vive en el handler, ya fuera de la transacción y justo antes de
firmar: lee `campaigns(id)` y `paused()` por RPC. Si el escrow está pausado, la
campaña expiró en el intervalo o el cupo se agotó, el job queda `failed` con
motivo y ese motivo se copia al `failureReason` del efecto.

El voucher nace al indexar `VoucherUnlocked(campaignId, user)`: se inserta la fila
en `consumer_voucher` con `expiresAt` = expiry de la campaña, se enlaza
`createdVoucherId` en el efecto y sube `unlockedCount`. La correlación `user` →
`consumerUserId` es por `lower(user.walletAddress)`, el patrón que ya usa
`confirmMatchingOrder`.

### Redeem

El flujo de solicitud y aprobación no cambia: el consumidor pide, el café aprueba
en `decide-voucher-redemption-service`. Lo que cambia es qué hay detrás de
`ConsumerChainPort.submitVoucherRedemption`.

Se implementa el adaptador real: encola `voucher_redeem` firmado por el
`campaignOperator` y devuelve la submission en `pending`. Al indexar
`VoucherRedeemed`, el voucher pasa a `redeemed`, se sella `redeemedAt`, y la
proyección descuenta el payout del budget y sube `redeemedCount`. Los mPEN salen
del escrow hacia la wallet del dueño del café: el contrato los manda al owner del
registry, no a una dirección elegida por el backend.

Consecuencia visible: el café aprueba y el voucher no queda canjeado en el acto,
sino cuando la cadena lo confirma. La pantalla de redenciones muestra ese estado
intermedio en vez de asumir éxito.

Los vouchers desbloqueados y no canjeados mueren con la expiry sin transacción
alguna: el contrato ya no los deja canjear y en Postgres se leen como expirados
por fecha.

## Llaves y bootstrap

`OPS_WALLET_INDEX` se suma a `src/config/env.ts`, derivado del mismo
`WALLET_MASTER_MNEMONIC`.

La elección del índice no es libre. Las wallets de usuario se reparten desde
`wallet_index_seq`, que arranca en 0, y `RELAYER_WALLET_INDEX` también es 0 por
defecto: los índices bajos se los va comiendo el registro de usuarios. Una
colisión daría a un usuario cualquiera la llave `owner` del escrow. Por eso
`OPS_WALLET_INDEX` es un índice reservado alto (por defecto `9000`, muy por
encima de cualquier valor que la secuencia alcance en el horizonte del MVP), y el
schema de env rechaza que sea igual a `RELAYER_WALLET_INDEX`.

Queda anotado como deuda separada, fuera de este slice: la misma colisión ya
existe hoy entre `RELAYER_WALLET_INDEX` y el primer usuario registrado. La
solución de fondo es que la secuencia de usuarios arranque por encima del rango
reservado a wallets de sistema.

El mnemónico local es de prueba y sólo para chain 31337; ninguna clave ni
mnemónico aparece en logs ni llega al cliente.

`scripts/dev-chain.ts` suma dos pasos tras desplegar el escrow:

1. `setCampaignOperator(relayerAddress)`.
2. `transferOwnership(opsAddress)` sobre `CampaignEscrow`.

El orden importa: `setCampaignOperator` es `onlyOwner` y el deployer todavía lo es.

`chain:bootstrap-local` suma, para el café demo: `MockPEN.mint` del presupuesto de
campaña al dueño del café, y la creación, fondeo y publicación de la campaña demo
en el escrow, enlazada a su fila de Postgres. `scripts/seed.ts` deja de insertar
la campaña suelta. En producción no hay mint: el café llega con su saldo.

## Errores

`parse-revert.ts` suma los errores del escrow. Clasificación:

**Permanentes** (job `failed`, sin reintento): `NotDraft`, `NotPublished`,
`CampaignNotFound`, `CampaignExpired`, `MaxVouchersReached`, `InsufficientBudget`,
`InsufficientFreeBalance`, `ExpiryInPast`, `ZeroAmount`, `CafeNotOperational`,
`VoucherNotUnlocked`, `NotCampaignOperator`, `OwnableUnauthorizedAccount`. Los dos
últimos son de configuración: reintentar no los arregla, y fallar ruidoso es lo
correcto.

**Idempotentes** (se tratan como éxito convergente, igual que `hasRecordedProof`
hoy): `VoucherAlreadyUnlocked` en `voucher_unlock`, `VoucherAlreadyRedeemed` en
`voucher_redeem`. Significan que la cadena ya está en el estado deseado.

**Transitorios** (reintento con backoff): `EnforcedPause` — una pausa
operacional se levanta.

De los permanentes, los que el usuario puede entender (`MaxVouchersReached`,
`CampaignExpired`) se traducen a un `failureReason` legible en el efecto. El
resto queda como diagnóstico interno; la UI no expone detalles de cadena.

## Testing

Unitarios:

- Validación de parámetros y transiciones de ciclo de vida (`domain/`).
- Selección de llave firmante y construcción de argumentos por handler.
- Clasificación de los reverts nuevos, incluidos los idempotentes.
- Decisiones de preflight, con estado de cadena inyectado.
- Proyección de los cinco eventos en `apply-event`, incluida la reaplicación
  (el indexer debe ser idempotente ante reindex).

Integración (`PUNCH_RUN_INTEGRATION=1`):

- Repositorio de campañas y unicidad de `idempotencyKey`.
- Que el índice parcial de `orderId` siga impidiendo dos jobs de compra para la
  misma orden.
- Elegibilidad de campaña leída de la proyección.

Cadena viva (`PUNCH_RUN_INTEGRATION=1 PUNCH_RUN_LIVE_CHAIN=1`), siguiendo el
patrón de `purchase-journey.live.test.ts`: un `campaign-journey.live.test.ts` que
recorre crear → fondear → publicar → compra que califica → unlock → canje, y
verifica que el saldo mPEN del dueño del café sube exactamente `voucherPayout` y
que el `budget` de la proyección baja lo mismo.

Verificación siempre con DB fresca y anvil fresco: crear DB → `pnpm db:migrate` →
`pnpm db:seed` → anvil 31337 → `pnpm chain:deploy` → `pnpm chain:bootstrap-local`.
`src/core/chain/addresses.local.json` nunca se commitea.

## Coordinación con las sesiones en paralelo

Tres líneas de trabajo tocan el mismo rail:

- Esta: campañas.
- Redención PUNCH on-chain: `PunchVault`, relayer, indexer.
- Pago de plan: `PlanManager`.

Dos puntos de choque y su mitigación:

1. **`relayer_job` y `relayer.ts`.** La generalización del rail se hace en un
   primer commit chico y autónomo, anunciado por `SendMessage` antes de tocar
   nada más, para que las otras dos ramas monten encima en vez de resolver el
   mismo problema tres veces.
2. **`PostgresMockConsumerChain`.** Implementa `submitVoucherRedemption` y
   `submitPunchRedemption`; las dos sesiones lo editarían a la vez. Propuesta:
   cada línea implementa su método en un adaptador propio detrás del mismo
   `ConsumerChainPort`, en vez de editar la misma clase.

`src/core/chain/abis.ts` no se toca desde acá.
