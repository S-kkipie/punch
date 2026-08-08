# NetworkFund — Diseño (sub-proyecto 6)

Fecha: 2026-08-08
Estado: aprobado en brainstorm
Spec madre: `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§02, §11, §12, §16, §20, §29)

## Propósito

Contrato que custodia el fondo común de la red: recibe los aportes de planes
y packs, los presupuesta por epoch mensual en cuatro buckets visibles
on-chain (40/30/20/10), cuenta referencias verificables, paga créditos de
origen prorrateados y financia el pool de coffee crawls.

No paga canjes PUNCH. La reserva de rewards vive en `PunchVault` y la reserva
no asignada en `PlanManager`; la separación contable de la invariante 11 es
estructural, no una convención de nombres.

## Decisiones aprobadas

1. **Contabilidad pull sobre saldo libre.** `PlanManager` transfiere 5e6 mPEN
   a la dirección del fondo en cada `subscribe`/`buyPack` mediante una
   transferencia ERC-20 directa, sin llamada: el mPEN llega pasivamente y el
   contrato no se entera. Por eso `fundEpoch(epoch, amount)` no hace
   `transferFrom`: toma `amount` del **saldo libre**
   (`pen.balanceOf(this) − totalBudgeted`) y lo reparte en los buckets del
   epoch. El mismo camino sirve para aportes externos que alguien transfiera
   directo al contrato.
2. **Distribución 40/30/20/10 como constantes inmutables.** Sin split
   settable por epoch. Cambiar la política en MVP significa desplegar otro
   contrato. Razón: cero superficie de gobierno para una red de cuatro cafés;
   §11 exige que la distribución sea visible on-chain, no que sea mutable.
3. **Dedup de referencias on-chain por `referralId`.** El conteo de
   referencias *es* dinero: alimenta el denominador del prorrateo. Un doble
   registro roba crédito a los demás cafés. La op real es
   `recordReferralWithProof(epoch, cafeId, bytes32 referralId)`, idempotente
   por id.
4. **`recordReferral(epoch, cafeId)` revierte siempre.** La firma congelada
   no lleva id, así que no puede deduplicar. Se conserva en el ABI —el
   interface congelado se respeta— pero revierte con `ReferralProofRequired()`
   para que no exista una segunda puerta sin dedup. Alternativa descartada:
   pedir ruling al coordinador para cambiar la firma congelada.
5. **Claim permissionless, pago al owner del café.** Cualquiera puede llamar
   `claimOriginCredit` (el relayer paga el gas), pero el mPEN va siempre al
   `owner` que reporta `CafeRegistry`, nunca a `msg.sender`. Exige
   `isOperational(cafeId)`: un café suspendido o `exited` no cobra.
6. **Sobrante liberable a saldo libre.** `releaseUnclaimedOrigin(epoch)`
   —owner-only, solo sobre epoch finalizado— devuelve el remanente del pool
   de origen al saldo libre, listo para que un `fundEpoch` futuro lo reparta.
   Cubre el polvo de la división entera y los créditos nunca reclamados. No
   crea valor nuevo (invariante 12) ni reescribe un epoch cerrado.
7. **`allocateCampaignBudget` debita solo el bucket de crawls.** §12.2: el
   coffee crawl lo financia el pool de crawls (20%). §12.1: la adquisición
   verificada la financia el café interesado, no el fondo. Los buckets de
   adquisición colectiva (30%) y contingencia (10%) son gasto operativo de
   red y salen por `withdrawBucket`, fuera de escrow.
8. **`Ownable` + `referralRecorder` settable + `Pausable`.** Mismo patrón que
   `PlanManager` (`setConsumptionLog`). El recorder es una llave rotable sin
   tocar al owner. §20 pide pausa en los contratos que mueven valor.
9. **Epoch con id libre y máquina de estados de dos posiciones.** El id lo
   elige ops (convención `YYYYMM`, ej. `202608`), sin orden forzado ni reloj
   on-chain. **Open**: acepta `fundEpoch` y referencias. **Finalized**:
   `totalReferrals` y `originPool` congelados, claims habilitados, sin más
   fondeo ni referencias. Sin reapertura.

## Riesgos aceptados

- `releaseUnclaimedOrigin` no tiene ventana temporal: el owner puede liberar
  el pool antes de que un café reclame. El freno es que el owner es el
  multisig PUNCH. Un `minClaimWindow` on-chain queda post-MVP.
- `claimOriginCredit` exige café operacional al reclamar: un café suspendido
  después de finalizar pierde su crédito, que vuelve al pool vía release.
- El backend es la única fuente de referencias. El contrato garantiza que
  cada `referralId` se cuente una sola vez, no que el hecho referido haya
  ocurrido (§02.15: las firmas son atestación, no prueba).

## Contrato

`packages/contracts/src/NetworkFund.sol` — reemplaza el stub `NotImplemented`.
Implementa `INetworkFund` (congelado, §16) + `Ownable` + `Pausable`.

### Constantes

```solidity
uint256 public constant BPS_DENOMINATOR = 10_000;
uint256 public constant ORIGIN_BPS      = 4_000; // créditos de origen
uint256 public constant ACQUISITION_BPS = 3_000; // adquisición colectiva
uint256 public constant CRAWL_BPS       = 2_000; // coffee crawls
uint256 public constant CONTINGENCY_BPS = 1_000; // seguridad y contingencia
```

Contingencia recibe el resto de la división entera
(`amount − origin − acquisition − crawl`), de modo que la suma de los cuatro
buckets es exactamente `amount`.

### Estado

```solidity
IERC20 public immutable pen;
ICafeRegistry public immutable registry;

address public referralRecorder;
address public campaignEscrow;

struct Epoch {
    uint256 originPool;      // snapshot fijo: denominador del prorrateo
    uint256 originPaid;      // acumulado ya reclamado
    uint256 acquisitionPool; // saldo vivo
    uint256 crawlPool;       // saldo vivo
    uint256 contingencyPool; // saldo vivo
    uint256 totalReferrals;
    bool finalized;
    bool originReleased;
}

mapping(uint256 epoch => Epoch) public epochs;
mapping(uint256 epoch => mapping(uint256 cafeId => uint256)) public referrals;
mapping(uint256 epoch => mapping(uint256 cafeId => bool)) public originClaimed;
mapping(bytes32 referralId => bool) public usedReferralId;

uint256 public totalBudgeted; // suma de todos los buckets vivos
```

`originPool` no se debita al pagar: es el denominador congelado de la fórmula
§29. Lo que se mueve es `originPaid` y `totalBudgeted`.

### Invariantes del contrato

- `pen.balanceOf(address(this)) >= totalBudgeted` — nunca se presupuesta más
  de lo custodiado.
- `totalBudgeted == Σ (originPool − originPaid + acquisitionPool + crawlPool + contingencyPool)`
  sobre los epochs no liberados.
- `originPaid <= originPool` por epoch.
- La suma de créditos de todos los cafés de un epoch nunca supera
  `originPool`.

### Operaciones

| Op | Autorización | Efecto y precondiciones |
|---|---|---|
| `fundEpoch(epoch, amount)` | owner, `whenNotPaused` | Epoch no finalizado, `amount > 0`, `amount <= freeBalance()`. Reparte en los cuatro buckets; `totalBudgeted += amount`. |
| `recordReferralWithProof(epoch, cafeId, referralId)` | `referralRecorder`, `whenNotPaused` | Epoch no finalizado, `registry.isOperational(cafeId)`, `referralId` sin usar y distinto de cero. Marca el id, `referrals[epoch][cafeId]++`, `totalReferrals++`. |
| `recordReferral(epoch, cafeId)` | — | Revierte `ReferralProofRequired()`. Existe solo para honrar el ABI congelado. |
| `finalizeOriginEpoch(epoch)` | owner | No finalizado. Congela `totalReferrals` y `originPool`. Permitido con cero referencias, para poder liberar el pool después. |
| `claimOriginCredit(epoch, cafeId)` | cualquiera, `whenNotPaused` | Finalizado, no liberado, no reclamado, `referrals > 0`, café operacional. `amount = originPool × referrals / totalReferrals`; paga al owner del registry. |
| `releaseUnclaimedOrigin(epoch)` | owner | Finalizado, no liberado, remanente `> 0`. Devuelve `originPool − originPaid` a saldo libre y marca `originReleased`; claims posteriores revierten. |
| `allocateCampaignBudget(epoch, amount)` | owner, `whenNotPaused` | `campaignEscrow` seteado, `amount > 0`, `amount <= crawlPool`. Debita crawls y transfiere al escrow. |
| `withdrawBucket(epoch, bucket, to, amount)` | owner | `bucket ∈ {Acquisition, Contingency}`, `to != 0`, `amount > 0` y disponible en el bucket. Gasto operativo, fuera de escrow; admite retiros parciales. |
| `setReferralRecorder(address)` | owner | Rota la llave del backend sin migrar el contrato. `address(0)` desconecta el registro. |
| `setCampaignEscrow(address)` | owner | Apunta al `CampaignEscrow` (sub-proyecto 7). |
| `pause()` / `unpause()` | owner | Congela todas las ops que mueven mPEN, incluidos los claims. |

Todas las ops que mueven mPEN siguen checks-effects-interactions: el bucket se
debita y el flag `claimed` se marca **antes** del `safeTransfer`.

### Vistas

- `freeBalance()` — `pen.balanceOf(this) − totalBudgeted`.
- `getEpoch(epoch)` — struct completo.
- `referralsOf(epoch, cafeId)`.
- `pendingOriginCredit(epoch, cafeId)` — cero si no finalizado, ya reclamado
  o liberado.

### Errores

Custom errors free-standing a nivel de archivo (convención del repo):
`ZeroAddress`, `ZeroAmount`, `NotReferralRecorder`, `EpochFinalized`,
`EpochNotFinalized`, `InsufficientFreeBalance`, `ReferralProofRequired`,
`ReferralIdUsed`, `CafeNotOperational`, `OriginAlreadyClaimed`,
`NoReferrals`, `OriginPoolReleased`, `NothingToRelease`,
`InsufficientBucket`, `CampaignEscrowNotSet`.

### Eventos

Los cinco congelados de `INetworkFund` se conservan; sus firmas se refinan
donde el ruling del scaffold lo permite (eventos provisionales).

```solidity
event EpochFunded(uint256 indexed epoch, uint256 amount);
event EpochBucketsFunded(uint256 indexed epoch, uint256 origin, uint256 acquisition, uint256 crawl, uint256 contingency);
event ReferralRecorded(uint256 indexed epoch, uint256 indexed originCafeId, bytes32 indexed referralId);
event OriginEpochFinalized(uint256 indexed epoch, uint256 totalReferrals, uint256 originPool);
event OriginCreditClaimed(uint256 indexed epoch, uint256 indexed cafeId, uint256 amount);
event CampaignBudgetAllocated(uint256 indexed epoch, uint256 amount);
event BucketWithdrawn(uint256 indexed epoch, uint8 indexed bucket, address indexed to, uint256 amount);
event UnclaimedOriginReleased(uint256 indexed epoch, uint256 amount);
event ReferralRecorderSet(address indexed recorder);
event CampaignEscrowSet(address indexed escrow);
```

`EpochBucketsFunded` deja el desglose legible on-chain sin recalcular
porcentajes. El `referralId` indexado hace `ReferralRecorded` idempotente
para el indexer.

### Constructor y despliegue

`constructor(IERC20 pen_, ICafeRegistry registry_) Ownable(msg.sender)`, con
rechazo de direcciones cero. `referralRecorder` y `campaignEscrow` se
configuran después del deploy.

`script/DeployNetworkFund.s.sol` — script propio. **No se toca**
`script/Deploy.s.sol`.

## Pruebas

Siguiendo el patrón de `PlanManager.t.sol` + `PlanManagerInvariant.t.sol`.

`test/NetworkFund.t.sol` — unit:

- Happy path por op, incluyendo el desglose exacto de buckets al fondear.
- Acceso denegado por op (no-owner, no-recorder).
- `fundEpoch` más allá del saldo libre; `fundEpoch` sobre epoch finalizado.
- Referencia con `referralId` duplicado; referencia tras finalizar;
  referencia de café no operacional.
- `recordReferral` sin id revierte `ReferralProofRequired`.
- Claim doble; claim de café suspendido; claim de café con cero referencias;
  claim sobre epoch no finalizado; claim tras release.
- Prorrateo exacto con reparto desigual (3/1 referencias) y con polvo de
  redondeo (denominador que no divide exacto).
- Release del remanente y reingreso a saldo libre; `fundEpoch` posterior que
  lo reutiliza.
- `allocateCampaignBudget` sin escrow seteado y más allá del bucket de crawls.
- `withdrawBucket` solo admite `Acquisition` y `Contingency`; retiro parcial y
  retiro más allá del bucket.
- Todas las ops pausables revierten bajo `pause`.

`test/NetworkFundInvariant.t.sol` — handler que fondea, registra referencias,
finaliza, reclama y libera al azar, verificando los cuatro invariantes de la
sección anterior.

Fuzz del prorrateo: para cualquier reparto de referencias, la suma de los
créditos de todos los cafés nunca supera `originPool`.

**Footgun Foundry:** una view call después de `vm.prank` consume el prank.
Cachear las vistas antes de prankear.

## Archivos

Exclusivos de este sub-proyecto:

- `src/NetworkFund.sol`
- `test/NetworkFund.t.sol`
- `test/NetworkFundInvariant.t.sol`
- `script/DeployNetworkFund.s.sol`

De `test/Scaffold.t.sol` se elimina **solo** el stub propio
(`test_networkFund_reverts_notImplemented` con su import, su field y su línea
de `setUp`). No se tocan `ConsumptionLog`, `PunchVault`, `CampaignEscrow` ni
archivos de otros frentes.

## Fuera de alcance

- Splits configurables por epoch.
- Ventana mínima de claim antes de liberar.
- Aportes externos con contabilidad propia (hoy entran como saldo libre).
- Gasto del bucket de contingencia con políticas on-chain.
- Integración real con `CampaignEscrow`, que todavía es un stub
  (sub-proyecto 7): aquí solo se transfiere mPEN a su dirección.
