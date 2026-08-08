# PunchVault — Diseño (sub-proyecto 5)

Fecha: 2026-08-08
Estado: aprobado en brainstorm
Spec madre: `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§02, §08, §10, §16, §17, §21, §29)

## Propósito

Contrato que lleva el ledger PUNCH no transferible, custodia la reserva
asignada (S/0.30 por PUNCH vivo, recibida de PlanManager en cada emisión),
y ejecuta el canje: burn de 12 PUNCH + payout de S/3.60 al anfitrión en una
sola transacción.

## Decisiones aprobadas

1. **Cobertura por balance.** `issue` revierte si
   `pen.balanceOf(vault) < (totalLivePunch + 1) × 0.30e6`
   (`InsufficientReserve`). Sin contador interno de reserva que pueda
   divergir: el balance mPEN real ES la reserva. La orquestación de
   ConsumptionLog garantiza que PlanManager transfirió los S/0.30 antes del
   `issue` en la misma transacción. Donaciones externas solo suben
   cobertura — inofensivas.
2. **Redeemer settable aparte.** `setRedeemer(address) onlyOwner` — el
   backend/relayer de canjes. Rail separado de `setConsumptionLog` (rail de
   emisión): comprometer una llave no compromete el otro flujo.
3. **Payout al owner del registry.** El payout va a
   `registry.getCafe(hostCafeId).owner`. Una sola fuente de verdad de
   titularidad; el traspaso two-step del registry redirige payouts sin
   estado adicional.
4. **OZ Pausable.** `issue` y `redeem` con `whenNotPaused`;
   `pause`/`unpause` `onlyOwner`. §16: la pausa vive en los contratos que
   mueven valor. `balanceOf` sigue legible en pausa.

## Simetría económica clave

```text
12 PUNCH × S/0.30 = S/3.60 = payout exacto
```

Cada burn libera exactamente la reserva que el payout consume. La
invariante de cobertura se preserva por construcción en el canje; solo la
emisión necesita el check explícito.

## Contrato

`packages/contracts/src/PunchVault.sol` — reemplaza el stub
`NotImplemented`. Implementa `IPunchVault` (congelado, §16) + Ownable +
Pausable.

### Constantes

```solidity
uint256 public constant PUNCHES_PER_REWARD = 12;
uint256 public constant RESERVE_PER_PUNCH = 300_000;  // S/0.30
uint256 public constant HOST_PAYOUT = 3_600_000;      // S/3.60
```

### Estado

```solidity
IERC20 public immutable pen;
ICafeRegistry public immutable registry;
address public consumptionLog;  // rail de emisión, settable onlyOwner
address public redeemer;        // rail de canje, settable onlyOwner
mapping(address user => uint256) private _balances;
uint256 public totalLivePunch;
```

Constructor: `(pen, registry)`; `Ownable(msg.sender)`. Direcciones cero
revierten (`ZeroAddress()`).

### Operaciones

- `issue(address user, uint256 cafeId)` — solo `consumptionLog`
  (`NotConsumptionLog`), `whenNotPaused`, `user != address(0)`. Check de
  cobertura por balance (decisión 1); si pasa: `_balances[user] += 1`,
  `totalLivePunch += 1`, emite `PunchIssued(user, cafeId)`. Sin checks de
  registry: ConsumptionLog valida proof/producto y PlanManager valida plan
  activo + café operacional + crédito antes de llegar aquí. `cafeId` viaja
  solo al evento (procedencia para indexers); el vault no guarda qué café
  emitió cada PUNCH — por eso el balance sobrevive si el café emisor
  abandona la red (§08).
- `redeem(address user, uint256 hostCafeId, uint256 productId)` — solo
  `redeemer` (`NotRedeemer`), `whenNotPaused`. Valida en orden:
  1. `_balances[user] >= 12` (`InsufficientPunch(user, balance)` — §21
     «menos de 12 PUNCH: bloquear canje»);
  2. `registry.isOperational(hostCafeId)` (`HostNotOperational` — §21
     «anfitrión suspendido: bloquear canje»);
  3. `registry.isEligible(hostCafeId, productId, ProductKind.Reward)`
     (`ProductNotEligibleReward`).
  Después, atómico (inv. 8): `_balances[user] -= 12`,
  `totalLivePunch -= 12`, `pen.safeTransfer(owner, HOST_PAYOUT)` donde
  `(owner,) = registry.getCafe(hostCafeId)`. Emite `PunchBurned(user, 12)`,
  `RewardRedeemed(user, hostCafeId, productId)`,
  `HostPaid(hostCafeId, HOST_PAYOUT)`.
- `balanceOf(address user) view returns (uint256)`.
- Ops fuera del interface congelado: `setConsumptionLog(address)`,
  `setRedeemer(address)` (ambas admiten address(0) para desconectar el
  rail; emiten `ConsumptionLogSet`/`RedeemerSet`), `pause()`, `unpause()`.

### No transferible / no retirable (inv. 4, §08)

Por construcción: el contrato no expone ninguna función de transferencia
de PUNCH ni de retiro de mPEN. El único egreso de mPEN es el payout de
canje. No hay `transfer`, `approve`, ni retiro de reserva — la reserva
asignada queda bloqueada de por vida del PUNCH (inv. «café cancela con
PUNCH vivos: mantener reserva asignada», §21).

### Errores (free-standing, convención del repo)

```solidity
error ZeroAddress();
error NotConsumptionLog(address caller);
error NotRedeemer(address caller);
error InsufficientReserve(uint256 required, uint256 available);
error InsufficientPunch(address user, uint256 balance);
error HostNotOperational(uint256 cafeId);
error ProductNotEligibleReward(uint256 cafeId, uint256 productId);
```

Nota: `NotConsumptionLog` colisiona de nombre con el error homónimo de
`PlanManager.sol` — sin problema en Solidity (scope por archivo, imports
con nombre en tests), mismo precedente que `ZeroAddress`/`NotCafeOwner`
entre CafeRegistry y PlanManager.

### Invariantes del contrato

1. `pen.balanceOf(vault) ≥ totalLivePunch × RESERVE_PER_PUNCH` — cobertura
   (inv. 9).
2. `totalLivePunch == Σ _balances[user]` para todos los usuarios.
3. mPEN pagado acumulado == canjes × HOST_PAYOUT.

## Pruebas

`packages/contracts/test/PunchVault.t.sol` (unit) y
`packages/contracts/test/PunchVaultInvariant.t.sol` (handler + invariantes,
skill Trail of Bits property-based-testing — money path). CafeRegistry y
MockPEN reales; consumptionLog/redeemer como EOAs de test que simulan la
orquestación (transferir 0.30 al vault + llamar `issue`).

Unit:

1. `issue` acredita 1 PUNCH, sube `totalLivePunch`, emite `PunchIssued`.
2. `issue` revierte: caller ≠ consumptionLog / cobertura insuficiente
   (balance exacto − 1 wei) / user cero / pausado.
3. `issue` con cobertura exacta (balance == (live+1)×0.30) pasa.
4. `redeem` quema 12, paga 3.60 al owner del café, emite los 3 eventos.
5. `redeem` revierte: caller ≠ redeemer / balance < 12 / anfitrión
   suspendido / producto no elegible Reward / pausado.
6. Canje con anfitrión ≠ emisor funciona (cross-café, corazón de la red).
7. Balance sobrevive suspensión/exit del café emisor; canje en otro café
   activo procede (§08).
8. Payout redirige tras traspaso two-step de titularidad en registry.
9. `setConsumptionLog`/`setRedeemer`/`pause`/`unpause` onlyOwner;
   address(0) desconecta rail.
10. 12 emisiones → 1 canje deja al vault con balance mPEN exacto 0 (si
    solo entró 0.30×12) — simetría económica.

Invariantes (handler con acciones aleatorias emit/redeem/donate/pause):

- Cobertura: `pen.balanceOf(vault) ≥ totalLivePunch × 0.30e6`.
- Conservación: `totalLivePunch == Σ balances` de los usuarios del handler.
- Pagos: mPEN salido == redeems × 3.60e6 (ghost counter).

Scaffold: eliminar solo `test_punchVault_reverts_notImplemented` de
`Scaffold.t.sol` (con su import/field/setUp si quedan exclusivos).

## Deploy

`packages/contracts/script/DeployPunchVault.s.sol` — patrón
`DeployMockPEN.s.sol`: lee `PEN_ADDRESS` y `CAFE_REGISTRY_ADDRESS` de env,
despliega dentro de start/stopBroadcast, retorna la instancia.
`Deploy.s.sol` compartido no se toca.

## Fuera de alcance

- Validación de proof EIP-712 — ConsumptionLog (sub-proyecto 4, en
  paralelo).
- Reserva no asignada y créditos — ya en PlanManager.
- Expiración de PUNCH (inv. 16: no expira en MVP).
- Payout variable o por producto — S/3.60 fijo MVP (inv. 7).

## Coordinación paralela

Archivos exclusivos de este sub-proyecto: `PunchVault.sol`,
`PunchVault.t.sol`, `PunchVaultInvariant.t.sol`, `DeployPunchVault.s.sol`.
Compartido: `Scaffold.t.sol` (solo se elimina el stub propio; ConsumptionLog
y NetworkFund borran los suyos en sus ramas — conflicto trivial que
resuelve la sesión coordinadora al mergear).
