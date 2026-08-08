# PlanManager — Diseño (sub-proyecto 3)

Fecha: 2026-08-07
Estado: aprobado en brainstorm
Spec madre: `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§02, §09, §16, §17, §29)

## Propósito

Contrato que administra el plan mensual y packs de cada café: cobra en mPEN,
ejecuta el split, acredita créditos de emisión, custodia la reserva no
asignada (S/0.30 por crédito) y autoriza el consumo de créditos que dispara
la emisión de PUNCH.

## Decisiones aprobadas

1. **Custodia de reserva no asignada: PlanManager.** Los S/30 de cada
   compra permanecen en PlanManager mientras los créditos no se emiten. En
   cada `consumeCredit`, S/0.30 se transfieren al PunchVault, donde pasan a
   respaldar el PUNCH vivo (invariante 9). Razón: §16 asigna «reserva no
   asignada por café» a PlanManager, y el `IPunchVault` congelado no expone
   contabilidad de reserva no asignada ni función de devolución para
   cancelaciones.
2. **Autorización de `consumeCredit`: dirección única settable.**
   `setConsumptionLog(address) onlyOwner` (fuera del interface congelado,
   mismo patrón que `mint` de MockPEN). Solo esa dirección puede llamar
   `consumeCredit`. Testeable hoy con una dirección mock; en producción será
   el contrato ConsumptionLog (sub-proyecto 4).
3. **Sin reloj on-chain.** Créditos apilan sin períodos ni expiración
   (rollover total, §09; invariante 16). La cadencia mensual de cobro es
   responsabilidad del backend (§07).

## Reconciliación con la spec madre

§09 y §17 dibujan «S/30 → PunchVault» en el momento del split. Este diseño
lo reconcilia así: la porción de reserva queda en PlanManager como *reserva
no asignada* y fluye al Vault crédito por crédito al emitir. El total que
termina en el Vault por PUNCH vivo es idéntico; solo cambia el momento de
la transferencia. Esto preserva `withdrawUnusedReserve` sin tocar el
`IPunchVault` congelado.

§17 fija la orquestación de emisión: ConsumptionLog valida la proof, llama
`planManager.consumeCredit(cafeId)` y después `punchVault.issue(user, cafeId)`.
PlanManager **no** llama al Vault para emitir; solo descuenta el crédito y
reenvía los S/0.30.

## Contrato

`packages/contracts/src/PlanManager.sol` — reemplaza el stub
`NotImplemented`. Implementa `IPlanManager` (congelado, §16) + Ownable.

### Constantes (mPEN, 6 decimales)

```solidity
uint256 public constant PLAN_PRICE = 49e6;
uint256 public constant PACK_PRICE = 40e6;
uint256 public constant CREDITS_PER_PURCHASE = 100;
uint256 public constant RESERVE_PER_CREDIT = 300_000; // S/0.30
uint256 public constant PLAN_FUND_SHARE = 5e6;        // → NetworkFund
uint256 public constant PLAN_TREASURY_SHARE = 14e6;   // → Treasury
uint256 public constant PACK_FUND_SHARE = 5e6;
uint256 public constant PACK_TREASURY_SHARE = 5e6;
```

Reserva por compra = precio − fund − treasury = 30e6 = 100 × 300_000. Se
verifica con asserts de test, no on-chain.

### Estado

```solidity
IERC20 public immutable pen;
ICafeRegistry public immutable registry;
address public immutable vault;       // receptor de reserva asignada
address public immutable networkFund;
address public immutable treasury;
address public consumptionLog;        // settable onlyOwner

mapping(uint256 cafeId => uint256) public credits;
mapping(uint256 cafeId => uint256) public unallocatedReserve;
mapping(uint256 cafeId => bool) public planActive;
```

Constructor: `(pen, registry, vault, networkFund, treasury)`;
`Ownable(msg.sender)` como MockPEN. Direcciones cero revierten
(`ZeroAddress()`).

### Operaciones

- `subscribe(cafeId)` — requiere `registry.isAuthorized(cafeId, msg.sender)`
  y `registry.isOperational(cafeId)`. `transferFrom(msg.sender, …, 49e6)`
  repartido en la misma tx: 5e6 → networkFund, 14e6 → treasury, 30e6 quedan
  en el contrato. `credits += 100`, `unallocatedReserve += 30e6`,
  `planActive = true`. Emite `PlanActivated(cafeId)`. Repetible (renovación
  o reactivación tras cancel): siempre suma créditos y activa.
- `buyPack(cafeId)` — igual con 40e6 (5e6 fund / 5e6 treasury / 30e6
  reserva) y requisito extra `planActive[cafeId]`. Emite
  `PackPurchased(cafeId)`.
- `consumeCredit(cafeId)` — solo `consumptionLog`
  (`NotConsumptionLog()` si no). Requiere `planActive`, café operacional y
  `credits > 0`. `credits -= 1`, `unallocatedReserve -= 300_000`,
  `pen.transfer(vault, 300_000)`. Emite `EmissionCreditConsumed(cafeId)`.
- `cancel(cafeId)` — solo owner del café (`registry.getCafe`). Requiere
  `planActive`. `planActive = false`; créditos y reserva quedan congelados
  (café inactivo no emite ni compra packs, §09). Emite
  `PlanCancelled(cafeId)`.
- `withdrawUnusedReserve(cafeId)` — solo owner del café, requiere
  `!planActive` (`PlanStillActive()` si no) y reserva > 0. Transfiere
  `unallocatedReserve` completo al owner, zerea `credits` y
  `unallocatedReserve`. Emite `UnusedReserveWithdrawn(cafeId, amount)`. La
  reserva de PUNCH vivos vive en el Vault y es inalcanzable desde aquí, así
  que el retiro nunca viola la invariante 9.
- `setConsumptionLog(address)` — `onlyOwner`, fuera del interface
  congelado. Permite address(0) para desconectar en emergencia.

### Errores (free-standing, convención del repo)

```solidity
error ZeroAddress();
error NotAuthorizedForCafe(uint256 cafeId, address account);
error CafeNotOperational(uint256 cafeId);
error PlanNotActive(uint256 cafeId);
error PlanStillActive(uint256 cafeId);
error NoCredits(uint256 cafeId);
error NotConsumptionLog(address caller);
error NotCafeOwner(uint256 cafeId, address account);
error NothingToWithdraw(uint256 cafeId);
```

### Invariantes del contrato

1. `unallocatedReserve[cafeId] == credits[cafeId] × RESERVE_PER_CREDIT`
   para todo café, siempre.
2. `pen.balanceOf(address(this)) ≥ Σ unallocatedReserve[cafeId]`.
3. Ninguna operación mueve mPEN salvo las transferencias descritas.

## Pruebas

`packages/contracts/test/PlanManager.t.sol`. Mock del registry no hace
falta: se despliega CafeRegistry real (barato, ya shipped). mPEN real.
Vault/networkFund/treasury como direcciones EOA de test (el Vault real aún
no existe; PlanManager solo le transfiere mPEN).

Unit:

1. `subscribe` reparte 5/14 y retiene 30; créditos 100; plan activo; evento.
2. `subscribe` revierte si caller no autorizado o café no operacional.
3. `buyPack` reparte 5/5/30 y suma 100; revierte sin plan activo.
4. `consumeCredit` descuenta 1 crédito, envía 0.30 al vault; evento.
5. `consumeCredit` revierte: caller ≠ consumptionLog / plan inactivo /
   café suspendido / créditos 0.
6. `cancel` solo owner del café; bloquea `buyPack` y `consumeCredit`.
7. `withdrawUnusedReserve` paga reserva completa al owner y zerea; revierte
   con plan activo o reserva 0.
8. Re-`subscribe` tras cancel reactiva y apila créditos sobre el remanente.
9. `setConsumptionLog` onlyOwner.

Fuzz + invariante (skill Trail of Bits property-based-testing — money
path):

- Fuzz: secuencias de subscribe/buyPack/consumeCredit con montos de faucet
  arbitrarios mantienen invariantes 1-2.
- Invariant test (handler): acciones aleatorias
  subscribe/buyPack/consume/cancel/withdraw sobre N cafés; asserts de
  invariantes 1-2 y de que el balance del vault crece exactamente
  0.30 × emisiones.

Scaffold: eliminar solo `test_planManager_reverts_notImplemented` de
`Scaffold.t.sol`.

## Deploy

`packages/contracts/script/DeployPlanManager.s.sol` — patrón
`DeployMockPEN.s.sol`: `run()` lee direcciones de env
(`PEN_ADDRESS`, `CAFE_REGISTRY_ADDRESS`, `PUNCH_VAULT_ADDRESS`,
`NETWORK_FUND_ADDRESS`, `TREASURY_ADDRESS`), despliega dentro de
start/stopBroadcast y retorna la instancia. `Deploy.s.sol` compartido no se
toca.

## Fuera de alcance

- Emisión de PUNCH (`vault.issue`) — orquesta ConsumptionLog (sub-proyecto 4).
- Contabilidad del Vault y payout de canjes (sub-proyecto 5).
- Cadencia mensual de cobro, precios y COGS — backend (§07).
- Pausable global: el freno es `setConsumptionLog(0)` + suspensión del café
  en el registry.

## Coordinación paralela

Archivos exclusivos de este sub-proyecto: `PlanManager.sol`,
`PlanManager.t.sol`, `DeployPlanManager.s.sol`. Compartido:
`Scaffold.t.sol` (solo se elimina el stub propio). No tocar
`ConsumptionLog`/`PunchVault` ni sus tests.
