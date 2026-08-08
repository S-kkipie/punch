# CampaignEscrow — Diseño (sub-proyecto 7)

Fecha: 2026-08-08
Estado: aprobado en brainstorm
Spec madre: `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§12, §16, §21, §29)

## Propósito

Último contrato del protocolo. Escrow de campañas de marketing: presupuesto
prefondeado en mPEN, vouchers no transferibles single-claim con expiry, y
payout de fulfillment al café origen. El escrow NO verifica condiciones de
campaña (el backend las verifica off-chain contra eventos de
ConsumptionLog); el enforcement on-chain es presupuesto, estado del ciclo,
single-claim y expiry.

## Decisiones aprobadas

1. **`publishCampaign` onlyOwner.** El interface congelado no tiene
   publish y `createCampaign(sourceCafeId)` no lleva parámetros de
   voucher. Op fuera del interface:
   `publishCampaign(campaignId, voucherPayout, maxVouchers, expiry)`.
   Exige presupuesto ≥ payout×max («campaña no promete más que escrow»,
   §29). Tras publicar: parámetros inmutables, cancel bloqueado.
2. **Un solo operator settable.** `setCampaignOperator(address) onlyOwner`
   — backend único autorizado para `recordProgress`, `unlockVoucher` y
   `redeemVoucher`. Comprometer la llave no toca mPEN de otros contratos y
   el payout siempre va al owner del café en el registry, nunca a una
   dirección arbitraria.
3. **Payout y refund al owner del sourceCafe.** `redeemVoucher` paga
   `voucherPayout` a `registry.getCafe(sourceCafeId).owner` (cubre
   fulfillment; exige `isOperational`). `cancelUnpublishedCampaign`
   devuelve el presupuesto completo al mismo owner. Una sola fuente de
   titularidad — mismo patrón que PunchVault.
4. **Crawls: sourceCafe = café que cumple.** Un coffee crawl es una
   campaña normal cuyo `sourceCafeId` es el café donde se canjea el
   voucher colectivo. Sus fondos llegan de
   `networkFund.allocateCampaignBudget` como saldo libre del escrow; la op
   `assignBudget(campaignId, amount) onlyOwner` los asigna a la campaña.
   Cero casos especiales en redeem.
5. **Vouchers Unlocked mueren con la expiry.** Pasada la expiry no se
   canjean (spec §12: «expiry propia») y no reservan presupuesto:
   `recoverExpiredBudget(campaignId)` recupera todo el residual.

## Contrato

`packages/contracts/src/CampaignEscrow.sol` — reemplaza el stub
`NotImplemented`. Implementa `ICampaignEscrow` (congelado, §16) + Ownable +
Pausable.

### Estado

```solidity
enum CampaignStatus { None, Draft, Published, Cancelled }
enum VoucherState { None, Unlocked, Redeemed }

struct Campaign {
    uint256 sourceCafeId;
    uint256 budget;         // mPEN asignado a esta campaña
    uint256 voucherPayout;  // fijado en publish
    uint256 maxVouchers;    // fijado en publish
    uint256 expiry;         // timestamp, fijado en publish
    uint256 unlockedCount;
    uint256 redeemedCount;
    CampaignStatus status;
}

IERC20 public immutable pen;
ICafeRegistry public immutable registry;
address public campaignOperator;              // settable onlyOwner
uint256 public nextCampaignId;                // ids desde 1
uint256 public totalAssignedBudget;           // Σ budgets de campañas
mapping(uint256 => Campaign) internal _campaigns;
mapping(uint256 => mapping(address => VoucherState)) public voucherState;
```

Constructor: `(pen, registry)`; `Ownable(msg.sender)`. Direcciones cero
revierten (`ZeroAddress()`).

Saldo libre = `pen.balanceOf(address(this)) − totalAssignedBudget` —
fondos de `allocateCampaignBudget` (transferencia directa de NetworkFund)
aún sin asignar.

### Ciclo de vida

- `createCampaign(uint256 sourceCafeId) returns (uint256)` — onlyOwner
  (ops crea campañas), `whenNotPaused`. Exige
  `registry.isOperational(sourceCafeId)` (`CafeNotOperational`). Id
  incremental desde 1, status Draft, emite
  `CampaignCreated(campaignId, sourceCafeId)`.
- `fundCampaign(uint256 campaignId, uint256 amount)` — permissionless,
  `whenNotPaused`, solo Draft (`NotDraft`), `amount > 0` (`ZeroAmount`).
  `pen.safeTransferFrom(msg.sender, this, amount)`;
  `budget += amount`, `totalAssignedBudget += amount`. Emite
  `CampaignFunded(campaignId, amount)`.
- `assignBudget(uint256 campaignId, uint256 amount)` — onlyOwner, fuera
  del interface, `whenNotPaused`, solo Draft, `amount > 0`. Exige saldo
  libre ≥ amount (`InsufficientFreeBalance`). Sin transferencia (los mPEN
  ya están en el escrow): `budget += amount`,
  `totalAssignedBudget += amount`. Emite
  `BudgetAssigned(campaignId, amount)`. Vía de fondeo de crawls.
- `publishCampaign(uint256 campaignId, uint256 voucherPayout, uint256 maxVouchers, uint256 expiry)`
  — onlyOwner, fuera del interface, `whenNotPaused`. Exige Draft,
  `voucherPayout > 0 && maxVouchers > 0` (`ZeroAmount`),
  `expiry > block.timestamp` (`ExpiryInPast`),
  `budget >= voucherPayout * maxVouchers` (`InsufficientBudget` — §21
  «escrow insuficiente: no publicar campaña»). Status → Published, fija
  los tres parámetros. Emite `CampaignPublished(campaignId,
  voucherPayout, maxVouchers, expiry)`.
- `recordProgress(uint256 campaignId, address user)` — solo operator
  (`NotCampaignOperator`), `whenNotPaused`, Published (`NotPublished`),
  `block.timestamp <= expiry` (`CampaignExpired`), `user != 0`. Solo
  emite `ProgressRecorded(campaignId, user)` — bookkeeping para indexers;
  el conteo de pasos vive en el backend.
- `unlockVoucher(uint256 campaignId, address user)` — solo operator,
  `whenNotPaused`, Published, no expirada, `user != 0`,
  `voucherState == None` (`VoucherAlreadyUnlocked`),
  `unlockedCount < maxVouchers` (`MaxVouchersReached`). Estado →
  Unlocked, `unlockedCount += 1`. Emite
  `VoucherUnlocked(campaignId, user)`.
- `redeemVoucher(uint256 campaignId, address user)` — solo operator,
  `whenNotPaused`, Published, no expirada,
  `voucherState == Unlocked` (`VoucherNotUnlocked` si None,
  `VoucherAlreadyRedeemed` si Redeemed),
  `registry.isOperational(sourceCafeId)` (`CafeNotOperational`). CEI:
  estado → Redeemed, `redeemedCount += 1`, `budget -= voucherPayout`,
  `totalAssignedBudget -= voucherPayout`, luego
  `pen.safeTransfer(owner, voucherPayout)` con
  `(owner,) = registry.getCafe(sourceCafeId)`. Emite
  `VoucherRedeemed(campaignId, user)`.
- `cancelUnpublishedCampaign(uint256 campaignId)` — onlyOwner,
  `whenNotPaused`, solo Draft (`NotDraft` — una publicada jamás se
  cancela, §16: «campaña publicada no puede retirar presupuesto
  comprometido»). Status → Cancelled; si `budget > 0`: refund completo al
  owner actual del sourceCafe, `totalAssignedBudget -= budget`,
  `budget = 0`. Emite `CampaignCancelled(campaignId)`.
- `recoverExpiredBudget(uint256 campaignId)` — onlyOwner, fuera del
  interface, `whenNotPaused`. Exige Published y
  `block.timestamp > expiry` (`CampaignNotExpired`), `budget > 0`
  (`NothingToRecover`). Transfiere el residual completo al owner actual
  del sourceCafe, `totalAssignedBudget -= budget`, `budget = 0`. Emite
  `ExpiredBudgetRecovered(campaignId, amount)`. Vouchers Unlocked no
  canjeados mueren con la expiry (decisión 5).
- `campaigns(uint256 campaignId) view returns (Campaign memory)` —
  getter explícito del struct.
- Ops: `setCampaignOperator(address)` (admite address(0) para
  desconectar; emite `CampaignOperatorSet`), `pause()`, `unpause()`.

### Invariantes del contrato

1. `pen.balanceOf(escrow) ≥ totalAssignedBudget` — el saldo libre nunca
   es negativo.
2. `totalAssignedBudget == Σ budgets` de todas las campañas.
3. Published viva: `budget ≥ (maxVouchers − redeemedCount) ×
   voucherPayout` — nunca promete más que escrow (§29). Se cumple por
   construcción: publish lo exige y cada redeem resta exactamente un
   payout de ambos lados.
4. Voucher: un solo claim por (campaña, user) — `VoucherState` solo
   avanza None → Unlocked → Redeemed (§21 «voucher reclamado: rechazar
   segundo claim»).
5. mPEN egresado == Σ redeems × voucherPayout + refunds + recuperaciones
   (ghost counters en tests).

### Errores (free-standing, convención del repo)

```solidity
error ZeroAddress();
error ZeroAmount();
error CampaignNotFound(uint256 campaignId);
error NotDraft(uint256 campaignId);
error NotPublished(uint256 campaignId);
error NotCampaignOperator(address caller);
error CafeNotOperational(uint256 cafeId);
error InsufficientBudget(uint256 required, uint256 available);
error InsufficientFreeBalance(uint256 requested, uint256 available);
error ExpiryInPast(uint256 expiry);
error CampaignExpired(uint256 campaignId);
error CampaignNotExpired(uint256 campaignId);
error VoucherAlreadyUnlocked(uint256 campaignId, address user);
error VoucherNotUnlocked(uint256 campaignId, address user);
error VoucherAlreadyRedeemed(uint256 campaignId, address user);
error MaxVouchersReached(uint256 campaignId);
error NothingToRecover(uint256 campaignId);
```

Colisiones de nombre con errores homónimos de otros contratos
(`ZeroAddress`, `CafeNotOperational`) — sin problema, scope por archivo e
imports con nombre en tests (precedente PlanManager/PunchVault).

## Pruebas

`packages/contracts/test/CampaignEscrow.t.sol` (unit) y
`packages/contracts/test/CampaignEscrowInvariant.t.sol` (handler +
invariantes, patrón PunchVault). CafeRegistry y MockPEN reales; operator y
funders como EOAs de test.

Unit (mínimo):

1. Ciclo feliz completo: create → fund → publish → unlock → redeem paga
   payout exacto al owner del café, eventos correctos.
2. `createCampaign` revierte: no owner / café no operational / pausado.
3. `fundCampaign` revierte: campaña inexistente / Published / Cancelled /
   amount 0. Suma budget y totalAssignedBudget.
4. `assignBudget`: asigna saldo libre (simulando allocateCampaignBudget
   con transfer directo); revierte si excede saldo libre / no Draft / no
   owner.
5. `publishCampaign` revierte: budget insuficiente (payout×max − 1 wei) /
   expiry pasado / no Draft / params cero; con budget exacto pasa.
6. `unlockVoucher`: revierte segundo unlock mismo user / al llegar a
   maxVouchers / expirada / caller ≠ operator.
7. `redeemVoucher`: revierte sin unlock / doble redeem / expirada / café
   suspendido / caller ≠ operator. Descuenta budget y paga al owner.
8. Payout redirige tras traspaso two-step de titularidad en registry.
9. `cancelUnpublishedCampaign`: refund completo, revierte sobre
   Published; fund posterior a cancel revierte.
10. `recoverExpiredBudget`: recupera residual (incl. vouchers Unlocked no
    canjeados), revierte antes de expiry / sobre Draft / budget 0.
11. Crawl end-to-end: transfer directo (saldo libre) → assignBudget →
    publish → unlock → redeem.
12. `setCampaignOperator`/`pause`/`unpause` onlyOwner; address(0)
    desconecta; ops de valor revierten en pausa.
13. Dos campañas simultáneas no cruzan presupuestos (redeem de una no
    afecta budget de la otra).

Invariantes (handler con acciones create/fund/assign/publish/unlock/
redeem/cancel/recover/donate/warp):

- `pen.balanceOf(escrow) ≥ totalAssignedBudget`.
- `totalAssignedBudget == Σ budgets`.
- Egresos == redeems×payouts + refunds + recuperaciones (ghost counters).
- Por campaña publicada viva: `budget ≥ (max − redeemed) × payout`.

Scaffold: eliminar el stub `test_campaignEscrow_reverts_notImplemented` de
`Scaffold.t.sol`. Es el último stub de contrato — el archivo queda solo
con MockPEN; conservarlo con su smoke test de MockPEN si existe, o
eliminar el archivo si queda vacío.

## Deploy

`packages/contracts/script/DeployCampaignEscrow.s.sol` — patrón
`DeployPunchVault.s.sol`: lee `PEN_ADDRESS` y `CAFE_REGISTRY_ADDRESS` de
env, despliega dentro de start/stopBroadcast, retorna la instancia.
`Deploy.s.sol` compartido no se toca.

Wiring post-deploy (owner txs, el script no lo hace):
`campaignEscrow.setCampaignOperator(backend)` y
`networkFund.setCampaignEscrow(escrow)`.

## Fuera de alcance

- Verificación on-chain de condiciones de campaña (compra previa, ventana,
  pasos de crawl) — backend contra eventos de ConsumptionLog.
- Fee de campaña (§13: futura, no aprobada).
- Win-back, subastas, bidding, segmentación, sponsors (§12.3 post-MVP).
- Campañas privadas (§ no-goals).

## Coordinación paralela

Archivos exclusivos: `CampaignEscrow.sol`, `CampaignEscrow.t.sol`,
`CampaignEscrowInvariant.t.sol`, `DeployCampaignEscrow.s.sol`. Compartido:
`Scaffold.t.sol` (borrar solo el stub propio). Ningún otro frente de
contratos activo — conflicto improbable.
