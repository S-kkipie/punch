# NetworkFund Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `NetworkFund`, el contrato que custodia el fondo común de PUNCH: presupuesta aportes por epoch en cuatro buckets, cuenta referencias verificables deduplicadas, paga créditos de origen prorrateados y financia el pool de coffee crawls.

**Architecture:** Un solo contrato Solidity, `NetworkFund is INetworkFund, Ownable, Pausable`, con `IERC20 pen` y `ICafeRegistry registry` inmutables. El mPEN llega pasivamente (`PlanManager` lo transfiere sin llamada), así que el presupuesto se toma del *saldo libre* = `pen.balanceOf(this) − totalBudgeted`. Cada epoch es un struct con cuatro buckets y dos flags (`finalized`, `originReleased`); no hay reloj on-chain.

**Tech Stack:** Solidity 0.8.30, Foundry (forge), OpenZeppelin (`Ownable`, `Pausable`, `IERC20`, `SafeERC20`), `MockPEN` y `CafeRegistry` del repo.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-08-08-networkfund-design.md`. Spec madre: `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§02, §11, §12, §16, §20, §29).
- `pragma solidity ^0.8.30;` y `// SPDX-License-Identifier: MIT` en todos los archivos nuevos.
- Custom errors **free-standing a nivel de archivo**, fuera del contrato (patrón de `PlanManager.sol` y `MockPEN.sol`).
- Las cinco ops congeladas de `INetworkFund` conservan nombre y firma: `fundEpoch`, `recordReferral`, `finalizeOriginEpoch`, `claimOriginCredit`, `allocateCampaignBudget`. Ops nuevas van **fuera** del interface, en el contrato.
- Los eventos de `INetworkFund` son provisionales por ruling del scaffold: este sub-proyecto puede refinar sus firmas editando `src/interfaces/INetworkFund.sol`.
- Archivos exclusivos de este frente: `src/NetworkFund.sol`, `src/interfaces/INetworkFund.sol`, `test/NetworkFund.t.sol`, `test/NetworkFundInvariant.t.sol`, `script/DeployNetworkFund.s.sol`. De `test/Scaffold.t.sol` se borra **solo** el stub propio. **Nunca** tocar `script/Deploy.s.sol`, ni `ConsumptionLog.sol`, `PunchVault.sol`, `CampaignEscrow.sol` ni sus tests.
- Todas las ops que mueven mPEN siguen checks-effects-interactions: debitar bucket y marcar flags **antes** del `safeTransfer`.
- **Footgun Foundry:** una view call después de `vm.prank` consume el prank. Cachear las vistas antes de prankear.
- Todos los comandos `forge` se ejecutan desde `packages/contracts/`.
- Mensajes de commit en inglés, Conventional Commits, con el trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/interfaces/INetworkFund.sol` (modificar) | Interface congelado. Solo se refinan firmas de eventos; las cinco ops no cambian. |
| `src/NetworkFund.sol` (reemplazar stub) | Todo el contrato: constantes, estado, ops congeladas, ops nuevas, vistas. Un solo archivo, ~230 líneas; misma escala que `PlanManager.sol`. |
| `test/NetworkFund.t.sol` (crear) | Unit tests: happy path, autorización, reversiones, aritmética del prorrateo, pausa. |
| `test/NetworkFundInvariant.t.sol` (crear) | Handler + invariantes de solvencia y contabilidad. |
| `script/DeployNetworkFund.s.sol` (crear) | Deploy propio, con direcciones por env var. |
| `test/Scaffold.t.sol` (modificar) | Se elimina el stub `test_networkFund_reverts_notImplemented` y sus referencias. |

---

### Task 1: Esqueleto, presupuesto por epoch y baja del stub

Deja el contrato desplegable con estado, llaves rotables, pausa y `fundEpoch` funcionando. Incluye la baja del stub de scaffold porque el contrato deja de revertir `NotImplemented` en este mismo paso: si no se borra, la suite queda roja.

**Files:**
- Modify: `src/interfaces/INetworkFund.sol`
- Modify: `src/NetworkFund.sol` (reemplaza el stub `NotImplemented`)
- Modify: `test/Scaffold.t.sol` (borrar solo el stub de NetworkFund)
- Test: `test/NetworkFund.t.sol` (crear)

**Interfaces:**
- Consumes: `ICafeRegistry` (`isOperational`, `getCafe`), `MockPEN` (`mint(address,uint256)` onlyOwner, `faucet(uint256)`), OpenZeppelin `Ownable`, `Pausable`, `SafeERC20`.
- Produces: `NetworkFund(IERC20 pen_, ICafeRegistry registry_)`; `freeBalance() → uint256`; `totalBudgeted() → uint256`; `getEpoch(uint256) → Epoch memory`; `fundEpoch(uint256 epoch, uint256 amount)`; `setReferralRecorder(address)`; `setCampaignEscrow(address)`; `pause()` / `unpause()`; struct `Epoch`; enum `Bucket { Acquisition, Contingency }`; constantes `BPS_DENOMINATOR`, `ORIGIN_BPS`, `ACQUISITION_BPS`, `CRAWL_BPS`, `CONTINGENCY_BPS`; errores `ZeroAddress`, `ZeroAmount`, `EpochFinalized`, `InsufficientFreeBalance`.

- [ ] **Step 1: Refinar los eventos del interface**

Reemplazar el contenido de `src/interfaces/INetworkFund.sol` por:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface INetworkFund {
    event EpochFunded(uint256 indexed epoch, uint256 amount);
    event ReferralRecorded(uint256 indexed epoch, uint256 indexed originCafeId, bytes32 indexed referralId);
    event OriginEpochFinalized(uint256 indexed epoch, uint256 totalReferrals, uint256 originPool);
    event OriginCreditClaimed(uint256 indexed epoch, uint256 indexed cafeId, uint256 amount);
    event CampaignBudgetAllocated(uint256 indexed epoch, uint256 amount);

    function fundEpoch(uint256 epoch, uint256 amount) external;
    function recordReferral(uint256 epoch, uint256 originCafeId) external;
    function finalizeOriginEpoch(uint256 epoch) external;
    function claimOriginCredit(uint256 epoch, uint256 cafeId) external;
    function allocateCampaignBudget(uint256 epoch, uint256 amount) external;
}
```

Las cinco firmas de función quedan intactas: solo cambian `ReferralRecorded` (gana `referralId` indexado, para que el indexer pueda deduplicar) y `OriginEpochFinalized` (gana el snapshot).

- [ ] **Step 2: Escribir el test que falla**

Crear `test/NetworkFund.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NetworkFund, ZeroAddress, ZeroAmount, EpochFinalized, InsufficientFreeBalance} from "../src/NetworkFund.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {INetworkFund} from "../src/interfaces/INetworkFund.sol";

contract NetworkFundTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    NetworkFund internal fund;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal recorder = makeAddr("recorder");
    address internal escrow = makeAddr("escrow");
    address internal ops = makeAddr("ops");
    address internal stranger = makeAddr("stranger");

    address internal cafeOwnerA = makeAddr("cafeOwnerA");
    address internal cafeOwnerB = makeAddr("cafeOwnerB");
    uint256 internal cafeA;
    uint256 internal cafeB;

    uint256 internal constant EPOCH = 202608;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        // Cache the role before pranking: the view call would consume a vm.prank.
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vm.startPrank(registrar);
        cafeA = registry.registerCafe(cafeOwnerA);
        cafeB = registry.registerCafe(cafeOwnerB);
        registry.setCafeStatus(cafeA, ICafeRegistry.CafeStatus.Active);
        registry.setCafeStatus(cafeB, ICafeRegistry.CafeStatus.Active);
        vm.stopPrank();

        fund = new NetworkFund(IERC20(address(pen)), registry);
        fund.setReferralRecorder(recorder);
        fund.setCampaignEscrow(escrow);
    }

    /// @dev Mimics PlanManager: mPEN lands on the fund by plain transfer, no call.
    function _seed(uint256 amount) internal {
        pen.mint(address(fund), amount);
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new NetworkFund(IERC20(address(0)), registry);

        vm.expectRevert(ZeroAddress.selector);
        new NetworkFund(IERC20(address(pen)), ICafeRegistry(address(0)));
    }

    function test_freeBalance_countsUnbudgetedTransfers() public {
        assertEq(fund.freeBalance(), 0);
        _seed(100e6);
        assertEq(fund.freeBalance(), 100e6);
        assertEq(fund.totalBudgeted(), 0);
    }

    function test_fundEpoch_splitsIntoBuckets() public {
        _seed(100e6);

        vm.expectEmit(true, false, false, true, address(fund));
        emit INetworkFund.EpochFunded(EPOCH, 100e6);
        fund.fundEpoch(EPOCH, 100e6);

        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        assertEq(e.originPool, 40e6);
        assertEq(e.acquisitionPool, 30e6);
        assertEq(e.crawlPool, 20e6);
        assertEq(e.contingencyPool, 10e6);
        assertEq(fund.totalBudgeted(), 100e6);
        assertEq(fund.freeBalance(), 0);
    }

    function test_fundEpoch_remainderGoesToContingency() public {
        _seed(3);
        fund.fundEpoch(EPOCH, 3);

        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        // 3 * 4000/10000 = 1, 3 * 3000/10000 = 0, 3 * 2000/10000 = 0, remainder 2.
        assertEq(e.originPool, 1);
        assertEq(e.acquisitionPool, 0);
        assertEq(e.crawlPool, 0);
        assertEq(e.contingencyPool, 2);
        assertEq(e.originPool + e.acquisitionPool + e.crawlPool + e.contingencyPool, 3);
    }

    function test_fundEpoch_accumulatesAcrossCalls() public {
        _seed(200e6);
        fund.fundEpoch(EPOCH, 100e6);
        fund.fundEpoch(EPOCH, 100e6);

        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        assertEq(e.originPool, 80e6);
        assertEq(fund.totalBudgeted(), 200e6);
    }

    function test_fundEpoch_revertsBeyondFreeBalance() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.expectRevert(abi.encodeWithSelector(InsufficientFreeBalance.selector, 1, 0));
        fund.fundEpoch(EPOCH, 1);
    }

    function test_fundEpoch_revertsOnZeroAmount() public {
        vm.expectRevert(ZeroAmount.selector);
        fund.fundEpoch(EPOCH, 0);
    }

    function test_fundEpoch_onlyOwner() public {
        _seed(100e6);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.fundEpoch(EPOCH, 100e6);
    }

    function test_fundEpoch_revertsWhenPaused() public {
        _seed(100e6);
        fund.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        fund.fundEpoch(EPOCH, 100e6);

        fund.unpause();
        fund.fundEpoch(EPOCH, 100e6);
        assertEq(fund.totalBudgeted(), 100e6);
    }

    function test_setters_onlyOwnerAndEmit() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.setReferralRecorder(stranger);

        vm.expectEmit(true, false, false, false, address(fund));
        emit NetworkFund.ReferralRecorderSet(ops);
        fund.setReferralRecorder(ops);
        assertEq(fund.referralRecorder(), ops);

        vm.expectEmit(true, false, false, false, address(fund));
        emit NetworkFund.CampaignEscrowSet(ops);
        fund.setCampaignEscrow(ops);
        assertEq(fund.campaignEscrow(), ops);
    }
}
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `forge test --match-contract NetworkFundTest -vv`
Expected: FAIL en compilación — `NetworkFund` todavía no tiene constructor con argumentos ni los símbolos importados.

- [ ] **Step 4: Escribir la implementación mínima**

Reemplazar `src/NetworkFund.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INetworkFund} from "./interfaces/INetworkFund.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";

error ZeroAddress();
error ZeroAmount();
error EpochFinalized(uint256 epoch);
error InsufficientFreeBalance(uint256 requested, uint256 available);

/// @notice Custodies the shared network fund: budgets contributions per monthly epoch
/// into four on-chain buckets (40/30/20/10), counts verified referrals, pays prorated
/// origin credit and funds the coffee-crawl pool.
/// @dev This contract never pays PUNCH redemptions. Reward reserve lives in PunchVault
/// and unallocated reserve in PlanManager, so spec invariant 11 (separate ledgers) is
/// structural. PlanManager sends its S/5 share with a plain ERC-20 transfer and no call,
/// so funding is pull-based: `fundEpoch` draws from `freeBalance()`.
contract NetworkFund is INetworkFund, Ownable, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant ORIGIN_BPS = 4_000;
    uint256 public constant ACQUISITION_BPS = 3_000;
    uint256 public constant CRAWL_BPS = 2_000;
    uint256 public constant CONTINGENCY_BPS = 1_000;

    /// @notice Buckets an operator may withdraw directly. Origin is claimed by cafés and
    /// crawl is spent through CampaignEscrow, so neither is withdrawable.
    enum Bucket {
        Acquisition,
        Contingency
    }

    struct Epoch {
        uint256 originPool; // frozen at finalize: denominator of the prorate formula
        uint256 originPaid;
        uint256 acquisitionPool;
        uint256 crawlPool;
        uint256 contingencyPool;
        uint256 totalReferrals;
        bool finalized;
        bool originReleased;
    }

    IERC20 public immutable pen;
    ICafeRegistry public immutable registry;

    /// @notice Only address allowed to record referrals; the PUNCH backend in production.
    address public referralRecorder;
    /// @notice Destination of crawl budget allocations; the CampaignEscrow contract.
    address public campaignEscrow;

    mapping(uint256 epoch => Epoch) internal epochs;
    mapping(uint256 epoch => mapping(uint256 cafeId => uint256)) public referrals;
    mapping(uint256 epoch => mapping(uint256 cafeId => bool)) public originClaimed;
    mapping(bytes32 referralId => bool) public usedReferralId;

    /// @notice Sum of every live bucket across all epochs.
    uint256 public totalBudgeted;

    event EpochBucketsFunded(
        uint256 indexed epoch, uint256 origin, uint256 acquisition, uint256 crawl, uint256 contingency
    );
    event ReferralRecorderSet(address indexed recorder);
    event CampaignEscrowSet(address indexed escrow);

    constructor(IERC20 pen_, ICafeRegistry registry_) Ownable(msg.sender) {
        if (address(pen_) == address(0) || address(registry_) == address(0)) revert ZeroAddress();
        pen = pen_;
        registry = registry_;
    }

    /// @notice Rotates the backend key allowed to record referrals. address(0) disconnects it.
    function setReferralRecorder(address recorder) external onlyOwner {
        referralRecorder = recorder;
        emit ReferralRecorderSet(recorder);
    }

    /// @notice Points crawl allocations at the CampaignEscrow. address(0) disables them.
    function setCampaignEscrow(address escrow) external onlyOwner {
        campaignEscrow = escrow;
        emit CampaignEscrowSet(escrow);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc INetworkFund
    /// @dev Pull-based on purpose: contributions arrive as plain transfers, so there is no
    /// `transferFrom` here. The rounding remainder lands in contingency, keeping the four
    /// buckets summing to exactly `amount`.
    function fundEpoch(uint256 epoch, uint256 amount) external onlyOwner whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Epoch storage e = epochs[epoch];
        if (e.finalized) revert EpochFinalized(epoch);

        uint256 available = freeBalance();
        if (amount > available) revert InsufficientFreeBalance(amount, available);

        uint256 origin = amount * ORIGIN_BPS / BPS_DENOMINATOR;
        uint256 acquisition = amount * ACQUISITION_BPS / BPS_DENOMINATOR;
        uint256 crawl = amount * CRAWL_BPS / BPS_DENOMINATOR;
        uint256 contingency = amount - origin - acquisition - crawl;

        e.originPool += origin;
        e.acquisitionPool += acquisition;
        e.crawlPool += crawl;
        e.contingencyPool += contingency;
        totalBudgeted += amount;

        emit EpochFunded(epoch, amount);
        emit EpochBucketsFunded(epoch, origin, acquisition, crawl, contingency);
    }

    function recordReferral(uint256, uint256) external pure {
        revert();
    }

    function finalizeOriginEpoch(uint256) external pure {
        revert();
    }

    function claimOriginCredit(uint256, uint256) external pure {
        revert();
    }

    function allocateCampaignBudget(uint256, uint256) external pure {
        revert();
    }

    /// @notice mPEN held but not yet budgeted to any epoch.
    function freeBalance() public view returns (uint256) {
        return pen.balanceOf(address(this)) - totalBudgeted;
    }

    function getEpoch(uint256 epoch) external view returns (Epoch memory) {
        return epochs[epoch];
    }
}
```

Los cuatro `revert()` desnudos son andamios que las tareas 2, 3 y 5 reemplazan. No los deje así.

- [ ] **Step 5: Borrar el stub de scaffold**

En `test/Scaffold.t.sol` eliminar exactamente: el import `import {NetworkFund} from "../src/NetworkFund.sol";`, el campo `NetworkFund internal networkFund;`, la línea `networkFund = new NetworkFund();` de `setUp`, y la función completa `test_networkFund_reverts_notImplemented`. No tocar nada de `ConsumptionLog`, `PunchVault`, `CampaignEscrow` ni `MockPEN`.

- [ ] **Step 6: Correr la suite completa**

Run: `forge test`
Expected: PASS. Los tests de `NetworkFundTest` en verde y `ScaffoldTest` sin el stub eliminado.

- [ ] **Step 7: Commit**

```bash
git add src/NetworkFund.sol src/interfaces/INetworkFund.sol test/NetworkFund.t.sol test/Scaffold.t.sol
git commit -m "$(cat <<'EOF'
feat(networkfund): budget contributions into per-epoch buckets

Replace the NotImplemented stub with the real skeleton: immutable mPEN and
registry, rotatable recorder/escrow keys, Pausable, and pull-based fundEpoch
that draws from free balance and splits 40/30/20/10 with the rounding
remainder landing in contingency.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Referencias verificables con dedup

**Files:**
- Modify: `src/NetworkFund.sol`
- Test: `test/NetworkFund.t.sol`

**Interfaces:**
- Consumes: de la Task 1, `epochs`, `referrals`, `usedReferralId`, `referralRecorder`, error `EpochFinalized`.
- Produces: `recordReferralWithProof(uint256 epoch, uint256 originCafeId, bytes32 referralId)`; `recordReferral(uint256,uint256)` que siempre revierte `ReferralProofRequired()`; errores `NotReferralRecorder(address caller)`, `ReferralProofRequired()`, `ReferralIdUsed(bytes32 referralId)`, `CafeNotOperational(uint256 cafeId)`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/NetworkFund.t.sol` (y extender el bloque de imports desde `../src/NetworkFund.sol` con `NotReferralRecorder, ReferralProofRequired, ReferralIdUsed, CafeNotOperational`):

```solidity
    function _record(uint256 cafeId, bytes32 referralId) internal {
        vm.prank(recorder);
        fund.recordReferralWithProof(EPOCH, cafeId, referralId);
    }

    function test_recordReferral_withoutProofAlwaysReverts() public {
        vm.prank(recorder);
        vm.expectRevert(ReferralProofRequired.selector);
        fund.recordReferral(EPOCH, cafeA);

        // Not even the owner has a proof-less path.
        vm.expectRevert(ReferralProofRequired.selector);
        fund.recordReferral(EPOCH, cafeA);
    }

    function test_recordReferralWithProof_countsPerCafe() public {
        vm.expectEmit(true, true, true, false, address(fund));
        emit INetworkFund.ReferralRecorded(EPOCH, cafeA, keccak256("r1"));
        _record(cafeA, keccak256("r1"));
        _record(cafeA, keccak256("r2"));
        _record(cafeB, keccak256("r3"));

        assertEq(fund.referrals(EPOCH, cafeA), 2);
        assertEq(fund.referrals(EPOCH, cafeB), 1);
        assertEq(fund.getEpoch(EPOCH).totalReferrals, 3);
    }

    function test_recordReferralWithProof_rejectsDuplicateId() public {
        _record(cafeA, keccak256("r1"));

        vm.prank(recorder);
        vm.expectRevert(abi.encodeWithSelector(ReferralIdUsed.selector, keccak256("r1")));
        fund.recordReferralWithProof(EPOCH, cafeB, keccak256("r1"));

        assertEq(fund.getEpoch(EPOCH).totalReferrals, 1);
    }

    function test_recordReferralWithProof_rejectsDuplicateIdAcrossEpochs() public {
        _record(cafeA, keccak256("r1"));

        vm.prank(recorder);
        vm.expectRevert(abi.encodeWithSelector(ReferralIdUsed.selector, keccak256("r1")));
        fund.recordReferralWithProof(EPOCH + 1, cafeA, keccak256("r1"));
    }

    function test_recordReferralWithProof_rejectsZeroId() public {
        vm.prank(recorder);
        vm.expectRevert(ReferralProofRequired.selector);
        fund.recordReferralWithProof(EPOCH, cafeA, bytes32(0));
    }

    function test_recordReferralWithProof_onlyRecorder() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NotReferralRecorder.selector, stranger));
        fund.recordReferralWithProof(EPOCH, cafeA, keccak256("r1"));
    }

    function test_recordReferralWithProof_rejectsNonOperationalCafe() public {
        vm.prank(registrar);
        registry.setCafeStatus(cafeA, ICafeRegistry.CafeStatus.Suspended);

        vm.prank(recorder);
        vm.expectRevert(abi.encodeWithSelector(CafeNotOperational.selector, cafeA));
        fund.recordReferralWithProof(EPOCH, cafeA, keccak256("r1"));
    }

    function test_recordReferralWithProof_revertsWhenPaused() public {
        fund.pause();
        vm.prank(recorder);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        fund.recordReferralWithProof(EPOCH, cafeA, keccak256("r1"));
    }
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `forge test --match-contract NetworkFundTest -vv`
Expected: FAIL en compilación — `recordReferralWithProof` no existe y los errores nuevos no están declarados.

- [ ] **Step 3: Implementar**

En `src/NetworkFund.sol`, añadir a los errores free-standing:

```solidity
error NotReferralRecorder(address caller);
error ReferralProofRequired();
error ReferralIdUsed(bytes32 referralId);
error CafeNotOperational(uint256 cafeId);
```

Reemplazar el andamio `recordReferral` por:

```solidity
    /// @notice Records one verified referral attributed to `originCafeId`.
    /// @dev The referral count is money: it is the denominator of the origin prorate, so a
    /// double count steals credit from every other café. `referralId` (the backend's
    /// receipt/campaign identifier) makes this idempotent. Op lives outside the frozen
    /// interface, which has no room for the id.
    function recordReferralWithProof(uint256 epoch, uint256 originCafeId, bytes32 referralId)
        external
        whenNotPaused
    {
        if (msg.sender != referralRecorder) revert NotReferralRecorder(msg.sender);
        if (referralId == bytes32(0)) revert ReferralProofRequired();
        if (usedReferralId[referralId]) revert ReferralIdUsed(referralId);
        Epoch storage e = epochs[epoch];
        if (e.finalized) revert EpochFinalized(epoch);
        if (!registry.isOperational(originCafeId)) revert CafeNotOperational(originCafeId);

        usedReferralId[referralId] = true;
        referrals[epoch][originCafeId] += 1;
        e.totalReferrals += 1;

        emit ReferralRecorded(epoch, originCafeId, referralId);
    }

    /// @inheritdoc INetworkFund
    /// @dev Always reverts. The frozen signature carries no referral id, so it cannot
    /// deduplicate; keeping it callable would open a second, unguarded door into the
    /// count that decides how the origin pool is split. Use `recordReferralWithProof`.
    function recordReferral(uint256, uint256) external pure {
        revert ReferralProofRequired();
    }
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `forge test --match-contract NetworkFundTest -vv`
Expected: PASS, todos los tests de referencias incluidos.

- [ ] **Step 5: Commit**

```bash
git add src/NetworkFund.sol test/NetworkFund.t.sol
git commit -m "$(cat <<'EOF'
feat(networkfund): record verified referrals with on-chain dedup

recordReferralWithProof takes the backend's referralId and rejects repeats,
globally and not just per epoch. The frozen recordReferral has no id, so it
cannot deduplicate and now always reverts rather than leaving an unguarded
second door into the count that decides the origin split.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Cierre de epoch y claim prorrateado

**Files:**
- Modify: `src/NetworkFund.sol`
- Test: `test/NetworkFund.t.sol`

**Interfaces:**
- Consumes: de tareas 1-2, `epochs`, `referrals`, `originClaimed`, `totalBudgeted`, `registry.getCafe`, errores `EpochFinalized`, `CafeNotOperational`.
- Produces: `finalizeOriginEpoch(uint256 epoch)`; `claimOriginCredit(uint256 epoch, uint256 cafeId)`; `pendingOriginCredit(uint256 epoch, uint256 cafeId) → uint256`; errores `EpochNotFinalized(uint256 epoch)`, `OriginAlreadyClaimed(uint256 epoch, uint256 cafeId)`, `NoReferrals(uint256 epoch, uint256 cafeId)`, `OriginPoolReleased(uint256 epoch)`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/NetworkFund.t.sol` (extender el import con `EpochNotFinalized, OriginAlreadyClaimed, NoReferrals`):

```solidity
    function test_finalize_freezesSnapshotAndBlocksMoreInput() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));

        vm.expectEmit(true, false, false, true, address(fund));
        emit INetworkFund.OriginEpochFinalized(EPOCH, 1, 40e6);
        fund.finalizeOriginEpoch(EPOCH);

        assertTrue(fund.getEpoch(EPOCH).finalized);

        _seed(10e6);
        vm.expectRevert(abi.encodeWithSelector(EpochFinalized.selector, EPOCH));
        fund.fundEpoch(EPOCH, 10e6);

        vm.prank(recorder);
        vm.expectRevert(abi.encodeWithSelector(EpochFinalized.selector, EPOCH));
        fund.recordReferralWithProof(EPOCH, cafeA, keccak256("r2"));
    }

    function test_finalize_onlyOwnerAndOnlyOnce() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.finalizeOriginEpoch(EPOCH);

        fund.finalizeOriginEpoch(EPOCH);
        vm.expectRevert(abi.encodeWithSelector(EpochFinalized.selector, EPOCH));
        fund.finalizeOriginEpoch(EPOCH);
    }

    function test_claim_paysProrataToCafeOwner() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6); // originPool = 40e6
        _record(cafeA, keccak256("r1"));
        _record(cafeA, keccak256("r2"));
        _record(cafeA, keccak256("r3"));
        _record(cafeB, keccak256("r4"));
        fund.finalizeOriginEpoch(EPOCH);

        assertEq(fund.pendingOriginCredit(EPOCH, cafeA), 30e6);
        assertEq(fund.pendingOriginCredit(EPOCH, cafeB), 10e6);

        // Permissionless call, but the money goes to the registry owner, not the caller.
        vm.prank(stranger);
        fund.claimOriginCredit(EPOCH, cafeA);

        assertEq(pen.balanceOf(cafeOwnerA), 30e6);
        assertEq(pen.balanceOf(stranger), 0);
        assertEq(fund.pendingOriginCredit(EPOCH, cafeA), 0);
        assertEq(fund.getEpoch(EPOCH).originPaid, 30e6);
        assertEq(fund.totalBudgeted(), 70e6);
    }

    function test_claim_roundingDustStaysInPool() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6); // originPool = 40e6
        _record(cafeA, keccak256("r1"));
        _record(cafeA, keccak256("r2"));
        _record(cafeB, keccak256("r3"));
        fund.finalizeOriginEpoch(EPOCH);

        vm.prank(cafeOwnerA);
        fund.claimOriginCredit(EPOCH, cafeA);
        vm.prank(cafeOwnerB);
        fund.claimOriginCredit(EPOCH, cafeB);

        // 40e6 * 2/3 = 26666666, 40e6 * 1/3 = 13333333; 1 unit of dust remains budgeted.
        assertEq(pen.balanceOf(cafeOwnerA), 26_666_666);
        assertEq(pen.balanceOf(cafeOwnerB), 13_333_333);
        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        assertEq(e.originPool - e.originPaid, 1);
    }

    function test_claim_revertsOnSecondClaim() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);

        fund.claimOriginCredit(EPOCH, cafeA);
        vm.expectRevert(abi.encodeWithSelector(OriginAlreadyClaimed.selector, EPOCH, cafeA));
        fund.claimOriginCredit(EPOCH, cafeA);
    }

    function test_claim_revertsBeforeFinalize() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));

        vm.expectRevert(abi.encodeWithSelector(EpochNotFinalized.selector, EPOCH));
        fund.claimOriginCredit(EPOCH, cafeA);
    }

    function test_claim_revertsWithoutReferrals() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);

        vm.expectRevert(abi.encodeWithSelector(NoReferrals.selector, EPOCH, cafeB));
        fund.claimOriginCredit(EPOCH, cafeB);
    }

    function test_claim_revertsForSuspendedCafe() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);

        vm.prank(registrar);
        registry.setCafeStatus(cafeA, ICafeRegistry.CafeStatus.Suspended);

        vm.expectRevert(abi.encodeWithSelector(CafeNotOperational.selector, cafeA));
        fund.claimOriginCredit(EPOCH, cafeA);
        assertEq(fund.pendingOriginCredit(EPOCH, cafeA), 40e6);
    }

    function test_claim_revertsWhenPaused() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);
        fund.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        fund.claimOriginCredit(EPOCH, cafeA);
    }
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `forge test --match-contract NetworkFundTest -vv`
Expected: FAIL en compilación — `pendingOriginCredit` y los errores nuevos no existen; `finalizeOriginEpoch` y `claimOriginCredit` siguen siendo andamios que revierten sin datos.

- [ ] **Step 3: Implementar**

Añadir a los errores free-standing:

```solidity
error EpochNotFinalized(uint256 epoch);
error OriginAlreadyClaimed(uint256 epoch, uint256 cafeId);
error NoReferrals(uint256 epoch, uint256 cafeId);
error OriginPoolReleased(uint256 epoch);
```

Reemplazar los andamios `finalizeOriginEpoch` y `claimOriginCredit`:

```solidity
    /// @inheritdoc INetworkFund
    /// @dev Freezes the prorate denominator. Allowed with zero referrals so the pool of a
    /// dead epoch can still be released (spec §11: a closed epoch is never rewritten).
    function finalizeOriginEpoch(uint256 epoch) external onlyOwner {
        Epoch storage e = epochs[epoch];
        if (e.finalized) revert EpochFinalized(epoch);
        e.finalized = true;
        emit OriginEpochFinalized(epoch, e.totalReferrals, e.originPool);
    }

    /// @inheritdoc INetworkFund
    /// @dev Permissionless so a relayer can pay the gas, but the mPEN always goes to the
    /// owner the registry reports — never to `msg.sender`. `originPool` is never debited:
    /// it stays the frozen denominator of §29, and `originPaid` tracks what left.
    function claimOriginCredit(uint256 epoch, uint256 cafeId) external whenNotPaused {
        Epoch storage e = epochs[epoch];
        if (!e.finalized) revert EpochNotFinalized(epoch);
        if (e.originReleased) revert OriginPoolReleased(epoch);
        if (originClaimed[epoch][cafeId]) revert OriginAlreadyClaimed(epoch, cafeId);

        uint256 cafeReferrals = referrals[epoch][cafeId];
        if (cafeReferrals == 0) revert NoReferrals(epoch, cafeId);
        if (!registry.isOperational(cafeId)) revert CafeNotOperational(cafeId);

        (address cafeOwner,) = registry.getCafe(cafeId);
        uint256 amount = e.originPool * cafeReferrals / e.totalReferrals;

        originClaimed[epoch][cafeId] = true;
        e.originPaid += amount;
        totalBudgeted -= amount;
        pen.safeTransfer(cafeOwner, amount);

        emit OriginCreditClaimed(epoch, cafeId, amount);
    }
```

Y añadir la vista junto a `getEpoch`:

```solidity
    /// @notice Origin credit `cafeId` could claim for `epoch` right now; zero once claimed,
    /// released, or before the epoch is finalized.
    function pendingOriginCredit(uint256 epoch, uint256 cafeId) external view returns (uint256) {
        Epoch storage e = epochs[epoch];
        if (!e.finalized || e.originReleased || originClaimed[epoch][cafeId] || e.totalReferrals == 0) {
            return 0;
        }
        return e.originPool * referrals[epoch][cafeId] / e.totalReferrals;
    }
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `forge test --match-contract NetworkFundTest -vv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/NetworkFund.sol test/NetworkFund.t.sol
git commit -m "$(cat <<'EOF'
feat(networkfund): finalize epochs and pay prorated origin credit

finalizeOriginEpoch freezes the referral total and origin pool; claims are
permissionless but always pay the café owner the registry reports, and only
while the café is operational. originPool stays the frozen denominator of the
spec formula, so rounding dust simply remains unclaimed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Liberación del sobrante de origen

**Files:**
- Modify: `src/NetworkFund.sol`
- Test: `test/NetworkFund.t.sol`

**Interfaces:**
- Consumes: de la Task 3, `epochs`, `totalBudgeted`, errores `EpochNotFinalized`, `OriginPoolReleased`.
- Produces: `releaseUnclaimedOrigin(uint256 epoch)`; error `NothingToRelease(uint256 epoch)`; evento `UnclaimedOriginReleased(uint256 indexed epoch, uint256 amount)`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/NetworkFund.t.sol` (extender el import con `NothingToRelease, OriginPoolReleased`):

```solidity
    function test_release_returnsRemainderToFreeBalance() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6); // originPool = 40e6
        _record(cafeA, keccak256("r1"));
        _record(cafeB, keccak256("r2"));
        fund.finalizeOriginEpoch(EPOCH);

        fund.claimOriginCredit(EPOCH, cafeA); // 20e6 out
        assertEq(fund.freeBalance(), 0);

        vm.expectEmit(true, false, false, true, address(fund));
        emit NetworkFund.UnclaimedOriginReleased(EPOCH, 20e6);
        fund.releaseUnclaimedOrigin(EPOCH);

        // The mPEN never left the contract: it just stopped being budgeted.
        assertEq(fund.freeBalance(), 20e6);
        assertEq(fund.totalBudgeted(), 60e6);
        assertEq(pen.balanceOf(address(fund)), 80e6);
    }

    function test_release_blocksLaterClaims() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);
        fund.releaseUnclaimedOrigin(EPOCH);

        assertEq(fund.pendingOriginCredit(EPOCH, cafeA), 0);
        vm.expectRevert(abi.encodeWithSelector(OriginPoolReleased.selector, EPOCH));
        fund.claimOriginCredit(EPOCH, cafeA);
    }

    function test_release_freedAmountFundsANewEpoch() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        fund.finalizeOriginEpoch(EPOCH); // zero referrals: nobody can claim
        fund.releaseUnclaimedOrigin(EPOCH);

        assertEq(fund.freeBalance(), 40e6);
        fund.fundEpoch(EPOCH + 1, 40e6);
        assertEq(fund.getEpoch(EPOCH + 1).originPool, 16e6);
    }

    function test_release_requiresFinalizedAndNonEmpty() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.expectRevert(abi.encodeWithSelector(EpochNotFinalized.selector, EPOCH));
        fund.releaseUnclaimedOrigin(EPOCH);

        fund.finalizeOriginEpoch(EPOCH);
        fund.releaseUnclaimedOrigin(EPOCH);

        vm.expectRevert(abi.encodeWithSelector(OriginPoolReleased.selector, EPOCH));
        fund.releaseUnclaimedOrigin(EPOCH);

        fund.finalizeOriginEpoch(EPOCH + 1);
        vm.expectRevert(abi.encodeWithSelector(NothingToRelease.selector, EPOCH + 1));
        fund.releaseUnclaimedOrigin(EPOCH + 1);
    }

    function test_release_onlyOwner() public {
        fund.finalizeOriginEpoch(EPOCH);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.releaseUnclaimedOrigin(EPOCH);
    }
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `forge test --match-contract NetworkFundTest -vv`
Expected: FAIL en compilación — `releaseUnclaimedOrigin`, `UnclaimedOriginReleased` y `NothingToRelease` no existen.

- [ ] **Step 3: Implementar**

Añadir el error free-standing `error NothingToRelease(uint256 epoch);`, el evento `event UnclaimedOriginReleased(uint256 indexed epoch, uint256 amount);` junto a los demás eventos del contrato, y la op:

```solidity
    /// @notice Returns an epoch's unclaimed origin credit to free balance, ready for a
    /// future `fundEpoch`.
    /// @dev Covers both integer-division dust and cafés that never claimed (or were
    /// suspended before claiming). No transfer happens: the mPEN was already here, it just
    /// stops being budgeted, so no value is created (spec invariant 12). There is no
    /// minimum claim window in MVP — the owner is the PUNCH multisig.
    function releaseUnclaimedOrigin(uint256 epoch) external onlyOwner {
        Epoch storage e = epochs[epoch];
        if (!e.finalized) revert EpochNotFinalized(epoch);
        if (e.originReleased) revert OriginPoolReleased(epoch);

        uint256 remaining = e.originPool - e.originPaid;
        if (remaining == 0) revert NothingToRelease(epoch);

        e.originReleased = true;
        totalBudgeted -= remaining;

        emit UnclaimedOriginReleased(epoch, remaining);
    }
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `forge test --match-contract NetworkFundTest -vv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/NetworkFund.sol test/NetworkFund.t.sol
git commit -m "$(cat <<'EOF'
feat(networkfund): release unclaimed origin credit back to free balance

Rounding dust and credit no café claimed would otherwise stay budgeted
forever. releaseUnclaimedOrigin unbudgets the remainder of a finalized epoch
so a later fundEpoch can redistribute it; no transfer occurs, so no value is
created and the closed epoch is not rewritten.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Presupuesto de crawls y retiro de buckets operativos

**Files:**
- Modify: `src/NetworkFund.sol`
- Test: `test/NetworkFund.t.sol`

**Interfaces:**
- Consumes: de tareas previas, `epochs`, `campaignEscrow`, `totalBudgeted`, enum `Bucket`, errores `ZeroAmount`, `ZeroAddress`.
- Produces: `allocateCampaignBudget(uint256 epoch, uint256 amount)` implementado; `withdrawBucket(uint256 epoch, Bucket bucket, address to, uint256 amount)`; errores `InsufficientBucket(uint256 requested, uint256 available)`, `CampaignEscrowNotSet()`; evento `BucketWithdrawn(uint256 indexed epoch, Bucket indexed bucket, address indexed to, uint256 amount)`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/NetworkFund.t.sol` (extender el import con `InsufficientBucket, CampaignEscrowNotSet`):

```solidity
    function test_allocateCampaignBudget_debitsCrawlPoolOnly() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6); // crawlPool = 20e6

        vm.expectEmit(true, false, false, true, address(fund));
        emit INetworkFund.CampaignBudgetAllocated(EPOCH, 15e6);
        fund.allocateCampaignBudget(EPOCH, 15e6);

        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        assertEq(e.crawlPool, 5e6);
        assertEq(e.acquisitionPool, 30e6);
        assertEq(e.contingencyPool, 10e6);
        assertEq(e.originPool, 40e6);
        assertEq(pen.balanceOf(escrow), 15e6);
        assertEq(fund.totalBudgeted(), 85e6);
    }

    function test_allocateCampaignBudget_revertsBeyondCrawlPool() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.expectRevert(abi.encodeWithSelector(InsufficientBucket.selector, 20e6 + 1, 20e6));
        fund.allocateCampaignBudget(EPOCH, 20e6 + 1);
    }

    function test_allocateCampaignBudget_revertsWithoutEscrow() public {
        fund.setCampaignEscrow(address(0));
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.expectRevert(CampaignEscrowNotSet.selector);
        fund.allocateCampaignBudget(EPOCH, 1e6);
    }

    function test_allocateCampaignBudget_onlyOwnerAndPausable() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.allocateCampaignBudget(EPOCH, 1e6);

        fund.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        fund.allocateCampaignBudget(EPOCH, 1e6);
    }

    function test_withdrawBucket_partialAndFull() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.expectEmit(true, true, true, true, address(fund));
        emit NetworkFund.BucketWithdrawn(EPOCH, NetworkFund.Bucket.Acquisition, ops, 12e6);
        fund.withdrawBucket(EPOCH, NetworkFund.Bucket.Acquisition, ops, 12e6);
        fund.withdrawBucket(EPOCH, NetworkFund.Bucket.Contingency, ops, 10e6);

        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        assertEq(e.acquisitionPool, 18e6);
        assertEq(e.contingencyPool, 0);
        assertEq(pen.balanceOf(ops), 22e6);
        assertEq(fund.totalBudgeted(), 78e6);
    }

    function test_withdrawBucket_revertsBeyondBucket() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.expectRevert(abi.encodeWithSelector(InsufficientBucket.selector, 10e6 + 1, 10e6));
        fund.withdrawBucket(EPOCH, NetworkFund.Bucket.Contingency, ops, 10e6 + 1);
    }

    function test_withdrawBucket_rejectsZeroRecipientAndAmount() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.expectRevert(ZeroAddress.selector);
        fund.withdrawBucket(EPOCH, NetworkFund.Bucket.Acquisition, address(0), 1e6);

        vm.expectRevert(ZeroAmount.selector);
        fund.withdrawBucket(EPOCH, NetworkFund.Bucket.Acquisition, ops, 0);
    }

    function test_withdrawBucket_onlyOwner() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.withdrawBucket(EPOCH, NetworkFund.Bucket.Acquisition, stranger, 1e6);
    }
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `forge test --match-contract NetworkFundTest -vv`
Expected: FAIL en compilación — `withdrawBucket` y los errores nuevos no existen; `allocateCampaignBudget` sigue siendo el andamio.

- [ ] **Step 3: Implementar**

Añadir los errores free-standing:

```solidity
error InsufficientBucket(uint256 requested, uint256 available);
error CampaignEscrowNotSet();
```

Añadir el evento `event BucketWithdrawn(uint256 indexed epoch, Bucket indexed bucket, address indexed to, uint256 amount);` y reemplazar el andamio `allocateCampaignBudget`:

```solidity
    /// @inheritdoc INetworkFund
    /// @dev Debits the crawl bucket only: spec §12.2 funds coffee crawls from the crawl
    /// pool, while §12.1 makes verified acquisition the interested café's expense, not the
    /// fund's. The acquisition and contingency buckets leave through `withdrawBucket`.
    function allocateCampaignBudget(uint256 epoch, uint256 amount) external onlyOwner whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        address escrow = campaignEscrow;
        if (escrow == address(0)) revert CampaignEscrowNotSet();

        Epoch storage e = epochs[epoch];
        uint256 available = e.crawlPool;
        if (amount > available) revert InsufficientBucket(amount, available);

        e.crawlPool = available - amount;
        totalBudgeted -= amount;
        pen.safeTransfer(escrow, amount);

        emit CampaignBudgetAllocated(epoch, amount);
    }

    /// @notice Spends an operational bucket of an epoch. Origin and crawl are unreachable
    /// here by construction: origin is claimed by cafés, crawl goes through CampaignEscrow.
    function withdrawBucket(uint256 epoch, Bucket bucket, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        Epoch storage e = epochs[epoch];
        uint256 available = bucket == Bucket.Acquisition ? e.acquisitionPool : e.contingencyPool;
        if (amount > available) revert InsufficientBucket(amount, available);

        if (bucket == Bucket.Acquisition) {
            e.acquisitionPool = available - amount;
        } else {
            e.contingencyPool = available - amount;
        }
        totalBudgeted -= amount;
        pen.safeTransfer(to, amount);

        emit BucketWithdrawn(epoch, bucket, to, amount);
    }
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `forge test --match-contract NetworkFundTest -vv`
Expected: PASS. No debe quedar ningún `revert()` desnudo en `src/NetworkFund.sol`; verificar con `grep -n "revert();" src/NetworkFund.sol` (sin resultados).

- [ ] **Step 5: Commit**

```bash
git add src/NetworkFund.sol test/NetworkFund.t.sol
git commit -m "$(cat <<'EOF'
feat(networkfund): allocate crawl budget and spend operational buckets

allocateCampaignBudget debits only the crawl bucket and forwards to
CampaignEscrow, matching the spec split between crawl funding and
café-funded acquisition. withdrawBucket covers the acquisition and
contingency buckets, which are operational spend and never pass through
escrow.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Invariantes de solvencia y contabilidad

**Files:**
- Create: `test/NetworkFundInvariant.t.sol`

**Interfaces:**
- Consumes: la superficie completa de `NetworkFund` de las tareas 1-5, más `MockPEN.mint` y `CafeRegistry`.
- Produces: solo tests. Ningún símbolo de producción nuevo.

- [ ] **Step 1: Escribir el test de invariantes**

Crear `test/NetworkFundInvariant.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NetworkFund} from "../src/NetworkFund.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

/// @dev Drives random contribute/fund/record/finalize/claim/release/spend sequences over a
/// fixed café and epoch set, guarding each call so only state-machine-legal actions run.
contract NetworkFundHandler is Test {
    NetworkFund internal immutable fund;
    MockPEN internal immutable pen;
    address internal immutable recorder;
    address internal immutable ops;

    uint256[] internal cafeIds;
    uint256[] internal epochIds;
    uint256 internal referralNonce;

    constructor(
        NetworkFund fund_,
        MockPEN pen_,
        address recorder_,
        address ops_,
        uint256[] memory cafeIds_,
        uint256[] memory epochIds_
    ) {
        fund = fund_;
        pen = pen_;
        recorder = recorder_;
        ops = ops_;
        cafeIds = cafeIds_;
        epochIds = epochIds_;
    }

    function _epoch(uint256 seed) internal view returns (uint256) {
        return epochIds[seed % epochIds.length];
    }

    function _cafe(uint256 seed) internal view returns (uint256) {
        return cafeIds[seed % cafeIds.length];
    }

    /// @dev Mimics PlanManager's plain transfer: mPEN arrives with no call.
    function contribute(uint256 amount) external {
        amount = bound(amount, 1, 100e6);
        pen.mint(address(fund), amount);
    }

    function fundEpoch(uint256 seed, uint256 amount) external {
        uint256 epoch = _epoch(seed);
        uint256 free = fund.freeBalance();
        if (free == 0 || fund.getEpoch(epoch).finalized) return;
        amount = bound(amount, 1, free);
        fund.fundEpoch(epoch, amount);
    }

    function recordReferral(uint256 seed, uint256 cafeSeed) external {
        uint256 epoch = _epoch(seed);
        if (fund.getEpoch(epoch).finalized) return;
        referralNonce += 1;
        bytes32 referralId = keccak256(abi.encode(referralNonce));
        vm.prank(recorder);
        fund.recordReferralWithProof(epoch, _cafe(cafeSeed), referralId);
    }

    function finalize(uint256 seed) external {
        uint256 epoch = _epoch(seed);
        if (fund.getEpoch(epoch).finalized) return;
        fund.finalizeOriginEpoch(epoch);
    }

    function claim(uint256 seed, uint256 cafeSeed) external {
        uint256 epoch = _epoch(seed);
        uint256 cafeId = _cafe(cafeSeed);
        NetworkFund.Epoch memory e = fund.getEpoch(epoch);
        if (!e.finalized || e.originReleased) return;
        if (fund.originClaimed(epoch, cafeId) || fund.referrals(epoch, cafeId) == 0) return;
        fund.claimOriginCredit(epoch, cafeId);
    }

    function release(uint256 seed) external {
        uint256 epoch = _epoch(seed);
        NetworkFund.Epoch memory e = fund.getEpoch(epoch);
        if (!e.finalized || e.originReleased || e.originPool == e.originPaid) return;
        fund.releaseUnclaimedOrigin(epoch);
    }

    function allocate(uint256 seed, uint256 amount) external {
        uint256 epoch = _epoch(seed);
        uint256 crawl = fund.getEpoch(epoch).crawlPool;
        if (crawl == 0) return;
        amount = bound(amount, 1, crawl);
        fund.allocateCampaignBudget(epoch, amount);
    }

    function withdraw(uint256 seed, uint256 amount, bool contingency) external {
        uint256 epoch = _epoch(seed);
        NetworkFund.Epoch memory e = fund.getEpoch(epoch);
        uint256 available = contingency ? e.contingencyPool : e.acquisitionPool;
        if (available == 0) return;
        amount = bound(amount, 1, available);
        fund.withdrawBucket(
            epoch, contingency ? NetworkFund.Bucket.Contingency : NetworkFund.Bucket.Acquisition, ops, amount
        );
    }
}

contract NetworkFundInvariantTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    NetworkFund internal fund;
    NetworkFundHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal recorder = makeAddr("recorder");
    address internal escrow = makeAddr("escrow");
    address internal ops = makeAddr("ops");

    uint256[] internal cafeIds;
    uint256[] internal epochIds;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        // Cache the role before pranking: the view call would consume a vm.prank.
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vm.startPrank(registrar);
        for (uint256 i = 0; i < 4; i++) {
            uint256 cafeId = registry.registerCafe(makeAddr(string.concat("cafeOwner", vm.toString(i))));
            registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);
            cafeIds.push(cafeId);
        }
        vm.stopPrank();

        epochIds.push(202608);
        epochIds.push(202609);
        epochIds.push(202610);

        fund = new NetworkFund(IERC20(address(pen)), registry);
        fund.setReferralRecorder(recorder);
        fund.setCampaignEscrow(escrow);

        handler = new NetworkFundHandler(fund, pen, recorder, ops, cafeIds, epochIds);
        // The handler drives owner-only ops, so it must own the fund and the faucet.
        fund.transferOwnership(address(handler));
        pen.transferOwnership(address(handler));

        targetContract(address(handler));
    }

    /// @dev Never budget more than is custodied.
    function invariant_solvent() public view {
        assertGe(pen.balanceOf(address(fund)), fund.totalBudgeted());
    }

    /// @dev The ledger never drifts from the sum of live buckets.
    function invariant_budgetMatchesBuckets() public view {
        uint256 sum;
        for (uint256 i = 0; i < epochIds.length; i++) {
            NetworkFund.Epoch memory e = fund.getEpoch(epochIds[i]);
            if (!e.originReleased) sum += e.originPool - e.originPaid;
            sum += e.acquisitionPool + e.crawlPool + e.contingencyPool;
        }
        assertEq(sum, fund.totalBudgeted());
    }

    /// @dev The prorate can never overpay its own pool.
    function invariant_originPaidWithinPool() public view {
        for (uint256 i = 0; i < epochIds.length; i++) {
            NetworkFund.Epoch memory e = fund.getEpoch(epochIds[i]);
            assertLe(e.originPaid, e.originPool);
        }
    }
}
```

- [ ] **Step 2: Correr los invariantes**

Run: `forge test --match-contract NetworkFundInvariantTest -vv`
Expected: PASS. Si `invariant_budgetMatchesBuckets` falla, la causa casi siempre es una op que movió mPEN sin ajustar `totalBudgeted`: revisar la op que aparece en la secuencia del contraejemplo, no el test.

- [ ] **Step 3: Añadir el fuzz del prorrateo**

Añadir a `test/NetworkFund.t.sol`:

```solidity
    function testFuzz_prorate_neverExceedsPool(uint96 amount, uint8 refsA, uint8 refsB) public {
        amount = uint96(bound(amount, 1e6, 1_000e6));
        refsA = uint8(bound(refsA, 1, 20));
        refsB = uint8(bound(refsB, 1, 20));

        _seed(amount);
        fund.fundEpoch(EPOCH, amount);
        for (uint256 i = 0; i < refsA; i++) {
            _record(cafeA, keccak256(abi.encode("a", i)));
        }
        for (uint256 i = 0; i < refsB; i++) {
            _record(cafeB, keccak256(abi.encode("b", i)));
        }
        fund.finalizeOriginEpoch(EPOCH);

        uint256 originPool = fund.getEpoch(EPOCH).originPool;
        uint256 paid = fund.pendingOriginCredit(EPOCH, cafeA) + fund.pendingOriginCredit(EPOCH, cafeB);
        assertLe(paid, originPool);

        fund.claimOriginCredit(EPOCH, cafeA);
        fund.claimOriginCredit(EPOCH, cafeB);
        assertEq(pen.balanceOf(cafeOwnerA) + pen.balanceOf(cafeOwnerB), paid);
        assertLe(fund.getEpoch(EPOCH).originPaid, originPool);
    }
```

- [ ] **Step 4: Correr la suite completa**

Run: `forge test`
Expected: PASS, incluidos unit, fuzz e invariantes.

- [ ] **Step 5: Commit**

```bash
git add test/NetworkFundInvariant.t.sol test/NetworkFund.t.sol
git commit -m "$(cat <<'EOF'
test(networkfund): add solvency and accounting invariants

Handler drives random contribute/fund/record/finalize/claim/release/spend
sequences and asserts the fund never budgets more than it holds, the ledger
matches the sum of live buckets, and the prorate never overpays its pool.
Fuzz the origin split across uneven referral counts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Script de despliegue y verificación final

**Files:**
- Create: `script/DeployNetworkFund.s.sol`

**Interfaces:**
- Consumes: `NetworkFund` constructor de la Task 1.
- Produces: `DeployNetworkFund.run() → NetworkFund fund`.

- [ ] **Step 1: Escribir el script**

Crear `script/DeployNetworkFund.s.sol`, siguiendo el patrón de `DeployPlanManager.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NetworkFund} from "../src/NetworkFund.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

contract DeployNetworkFund is Script {
    function run() external returns (NetworkFund fund) {
        IERC20 pen = IERC20(vm.envAddress("PEN_ADDRESS"));
        ICafeRegistry registry = ICafeRegistry(vm.envAddress("CAFE_REGISTRY_ADDRESS"));

        vm.startBroadcast();
        fund = new NetworkFund(pen, registry);
        vm.stopBroadcast();
    }
}
```

`referralRecorder` y `campaignEscrow` se configuran después del deploy, con `setReferralRecorder` y `setCampaignEscrow`; el `CampaignEscrow` todavía no existe (sub-proyecto 7). No se toca `script/Deploy.s.sol`.

- [ ] **Step 2: Verificar que compila**

Run: `forge build`
Expected: compilación exitosa, sin warnings nuevos.

- [ ] **Step 3: Correr la verificación completa**

Run: `forge test && forge fmt --check`
Expected: toda la suite en verde y el formato limpio. Si `forge fmt --check` reporta diferencias, correr `forge fmt` y volver a verificar.

- [ ] **Step 4: Confirmar el alcance del diff**

Run: `git diff --stat main`
Expected: exactamente `src/NetworkFund.sol`, `src/interfaces/INetworkFund.sol`, `test/NetworkFund.t.sol`, `test/NetworkFundInvariant.t.sol`, `test/Scaffold.t.sol`, `script/DeployNetworkFund.s.sol` y los dos docs (spec y plan). Cualquier otro archivo es un error: revertirlo.

- [ ] **Step 5: Commit**

```bash
git add script/DeployNetworkFund.s.sol
git commit -m "$(cat <<'EOF'
chore(networkfund): add deploy script

Own script with env-var addresses, mirroring DeployPlanManager. The recorder
and escrow keys are configured post-deploy; CampaignEscrow does not exist yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Cobertura de la spec

| Requisito de la spec | Tarea |
|---|---|
| Contabilidad pull sobre saldo libre (decisión 1) | 1 |
| Buckets 40/30/20/10 inmutables, resto a contingencia (decisión 2) | 1 |
| Pausable + Ownable + recorder rotable (decisión 8) | 1 |
| Dedup de referencias por `referralId` (decisión 3) | 2 |
| `recordReferral` sin id revierte (decisión 4) | 2 |
| Epoch Open → Finalized, sin reapertura (decisión 9) | 1, 3 |
| Claim permissionless al owner del registry, café operacional (decisión 5) | 3 |
| Fórmula §29 con `originPool` congelado | 3 |
| Liberación de polvo y no reclamado (decisión 6) | 4 |
| `allocateCampaignBudget` solo desde crawls (decisión 7) | 5 |
| `withdrawBucket` para adquisición y contingencia | 5 |
| Invariantes de solvencia y contabilidad | 6 |
| Script de deploy propio | 7 |
| Baja del stub en `Scaffold.t.sol` | 1 |
